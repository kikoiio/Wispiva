-- Private, in-process story state. The host authenticates principals and owns
-- tickets; this reducer never treats client-supplied text as a world fact.
-- Export is for the private clean-shutdown checkpoint, not a public event log.
local M = {}

local DEFAULT_LIMITS = {
  interactions = 1024, operations = 2048, pending_per_actor = 32,
  offers = 128, context = 32, page = 64, text = 1000,
}

local function copy(value)
  if type(value) ~= "table" then return value end
  local out = {}
  for key, item in pairs(value) do out[key] = copy(item) end
  return out
end

local function nonempty(value)
  return type(value) == "string" and value ~= "" and #value <= 256
end

local function integer(value)
  return type(value) == "number" and value == value and value ~= math.huge
    and value ~= -math.huge and value >= 0 and value == math.floor(value)
end

local function count(map)
  local n = 0
  for _ in pairs(map) do n = n + 1 end
  return n
end

local function array_size(value)
  if type(value) ~= "table" then return nil end
  local n, top = 0, 0
  for key in pairs(value) do
    if type(key) ~= "number" or key < 1 or key ~= math.floor(key) then return nil end
    n, top = n + 1, math.max(top, key)
  end
  if n ~= top then return nil end
  return n
end

-- Canonical encoding is internal to the operation ledger. It is never logged
-- or returned in a receipt, because it may contain a private message.
local function canonical(value)
  local kind = type(value)
  if kind == "nil" then return "n" end
  if kind == "boolean" then return value and "t" or "f" end
  if kind == "number" then
    assert(value == value and value ~= math.huge and value ~= -math.huge, "invalid number")
    return "d" .. tostring(value) .. ";"
  end
  if kind == "string" then return "s" .. #value .. ":" .. value end
  assert(kind == "table", "invalid canonical payload")
  local keys = {}
  for key in pairs(value) do
    assert(type(key) == "string" or type(key) == "number", "invalid payload key")
    keys[#keys + 1] = key
  end
  table.sort(keys, function(a, b) return canonical(a) < canonical(b) end)
  local parts = {"{"}
  for _, key in ipairs(keys) do
    parts[#parts + 1] = canonical(key)
    parts[#parts + 1] = canonical(value[key])
  end
  parts[#parts + 1] = "}"
  return table.concat(parts)
end

local function limits_from(input)
  local out = copy(DEFAULT_LIMITS)
  for key, value in pairs(input or {}) do
    assert(out[key] and integer(value) and value > 0, "invalid narrative limit")
    out[key] = value
  end
  return out
end

local function objects_from(origin_objects)
  assert(type(origin_objects) == "table", "origin objects required")
  local definitions = {}
  local n = array_size(origin_objects)
  assert(n, "origin objects must be an array")
  for i = 1, n do
    local object = copy(origin_objects[i])
    assert(type(object) == "table" and nonempty(object.id), "invalid object id")
    assert(not definitions[object.id], "duplicate object id")
    assert(type(object.initial_state) == "string", "invalid initial object state")
    assert(array_size(object.facets or {}) and type(object.transitions or {}) == "table",
      "invalid object definition")
    local states = {}
    for _, state in ipairs(object.states or {}) do
      assert(nonempty(state) and not states[state], "invalid or duplicate object state")
      states[state] = true
    end
    assert(states[object.initial_state], "initial object state is undeclared")
    for _, facet in ipairs(object.facets or {}) do
      assert(type(facet) == "table" and nonempty(facet.id) and nonempty(facet.text)
        and states[facet.state], "invalid object facet")
    end
    for transition_id, transition in pairs(object.transitions or {}) do
      assert(nonempty(transition_id) and type(transition) == "table"
        and states[transition.from] and states[transition.to] and transition.from ~= transition.to
        and array_size(transition.actors or {}), "invalid object transition")
    end
    definitions[object.id] = object
  end
  return definitions
end

local function fresh(origin_objects, actor_grants, options)
  options = options or {}
  assert(type(options) == "table", "invalid narrative options")
  assert(type(actor_grants) == "table", "actor grants required")
  local definitions = objects_from(origin_objects)
  local states = {}
  for id, definition in pairs(definitions) do
    states[id] = {revision = 0, state = definition.initial_state}
  end
  return {
    version = 1, world_id = options.world_id, origin_event_id = options.origin_event_id,
    sequence = 0, interactions = {}, operations = {}, offers = {},
    object_states = states, definitions = definitions, grants = copy(actor_grants),
    limits = limits_from(options.limits),
  }
end

local function receipt(status, operation_id, reason, extra)
  local out = {status = status, operation_id = operation_id, checkpointed = false}
  if reason then out.reason = reason end
  for key, value in pairs(extra or {}) do out[key] = copy(value) end
  return out
end

local function execute(state, operation_id, payload, action)
  assert(nonempty(operation_id), "operation id required")
  local encoded = canonical(payload)
  local previous = state.operations[operation_id]
  if previous then
    if previous.payload ~= encoded then
      return receipt("rejected", operation_id, "operation_conflict")
    end
    return copy(previous.receipt)
  end
  -- No eviction: once the ledger is full it stays full until a new world.
  if count(state.operations) >= state.limits.operations then
    return receipt("rejected", operation_id, "operation_capacity")
  end
  local result = action()
  state.operations[operation_id] = {payload = encoded, receipt = copy(result)}
  return copy(result)
end

local function append(state, entry)
  if #state.interactions >= state.limits.interactions then return nil end
  state.sequence = state.sequence + 1
  entry.id = "story:" .. state.sequence
  entry.sequence = state.sequence
  state.interactions[#state.interactions + 1] = entry
  return entry
end

local function facets_for(definition, object_state)
  local result = {}
  for _, facet in ipairs(definition.facets or {}) do
    if facet.state == nil or facet.state == object_state.state then
      result[#result + 1] = copy(facet)
    end
  end
  return result
end

local function interaction_by_id(state, id)
  if type(id) ~= "string" then return nil end
  local number = tonumber(string.match(id, "^story:(%d+)$"))
  if not number then return nil end
  return state.interactions[number]
end

function M.new(origin_objects, actor_grants, options)
  return fresh(origin_objects, actor_grants, options)
end

-- Translate the compiler's split public/private manifest into reducer inputs.
-- Transition permissions are copied from private authoring grants.
local function manifest_inputs(manifest, limits)
  assert(type(manifest) == "table" and type(manifest.public) == "table"
    and type(manifest.actors) == "table", "invalid narrative manifest")
  local private = manifest.private_objects or {}
  local public = {}
  for _, object in ipairs(manifest.public.objects or {}) do
    assert(type(object) == "table" and nonempty(object.id) and not public[object.id],
      "invalid public story object")
    public[object.id] = object
  end
  local definitions, grants = {}, {}
  for _, actor in ipairs(manifest.actors) do
    assert(type(actor.actor_id) == "string" and actor.actor_id ~= "", "invalid story actor")
    grants[actor.actor_id] = {}
  end
  for object_id, spec in pairs(private) do
    local public_object = public[object_id]
    assert(public_object and type(spec) == "table", "private story object has no public binding")
    local transitions = {}
    for _, transition in ipairs(spec.transitions or {}) do
      assert(type(transition) == "table" and type(transition.id) == "string",
        "invalid story transition")
      transitions[transition.id] = {from=transition.from, to=transition.to, actors={}}
    end
    for _, grant in ipairs(spec.grants or {}) do
      assert(type(grant) == "table" and grants[grant.actorId], "invalid story grant")
      grants[grant.actorId][object_id] = true
      for _, transition_id in ipairs(grant.transitionIds or {}) do
        assert(transitions[transition_id], "grant references unknown transition")
        transitions[transition_id].actors[#transitions[transition_id].actors + 1] = grant.actorId
      end
    end
    definitions[#definitions + 1] = {
      id=object_id, initial_state=spec.initial_state, states=copy(spec.states),
      facets=copy(spec.facets), transitions=transitions,
      render_by_state=copy(public_object.render_by_state or {}), public=true,
    }
  end
  table.sort(definitions, function(a, b) return a.id < b.id end)
  for object_id in pairs(public) do
    assert(private[object_id], "public story object has no private definition")
  end
  return definitions, grants, {world_id=manifest.world_id,
    origin_event_id=manifest.origin_event_id, limits=limits}
end

function M.new_from_manifest(manifest, limits)
  local definitions, grants, options = manifest_inputs(manifest, limits)
  return fresh(definitions, grants, options)
end

function M.load_from_manifest(snapshot, manifest, limits)
  local definitions, grants, options = manifest_inputs(manifest, limits)
  return M.load(snapshot, definitions, grants, options)
end

function M.inspect(state, operation_id, player, object_id, logical_time)
  local payload = {kind = "inspect", player = player, object_id = object_id, time = logical_time}
  return execute(state, operation_id, payload, function()
    if not nonempty(player) or not nonempty(object_id) or
        (logical_time ~= nil and not integer(logical_time)) then
      return receipt("rejected", operation_id, "invalid_input")
    end
    local definition, object_state = state.definitions[object_id], state.object_states[object_id]
    if not definition then return receipt("rejected", operation_id, "unknown_object") end
    for i = #state.interactions, 1, -1 do
      local prior = state.interactions[i]
      if prior.kind == "inspect" and prior.source.id == player and
          prior.object_id == object_id and prior.revision == object_state.revision then
        return receipt("already_discovered", operation_id, nil, {
          interaction_id = prior.id, object_id = object_id,
          revision = prior.revision, facets = prior.facets,
        })
      end
    end
    local entry = append(state, {
      kind = "inspect", operation_id = operation_id,
      source = {kind = "player", id = player},
      audience = {kind = "player", id = player}, object_id = object_id,
      revision = object_state.revision, facets = facets_for(definition, object_state),
      logical_time = logical_time,
    })
    if not entry then return receipt("rejected", operation_id, "history_capacity") end
    return receipt("accepted_this_run", operation_id, nil, {
      interaction_id = entry.id, object_id = object_id,
      revision = entry.revision, facets = entry.facets,
    })
  end)
end

local function pending_count(state, actor_id)
  local total = 0
  for _, entry in ipairs(state.interactions) do
    if entry.kind == "address" and entry.audience.id == actor_id and
        entry.status ~= "answered" then total = total + 1 end
  end
  return total
end

function M.address(state, operation_id, player, actor_id, text, logical_time)
  local payload = {kind = "address", player = player, actor_id = actor_id,
    text = text, time = logical_time}
  return execute(state, operation_id, payload, function()
    if not nonempty(player) or not nonempty(actor_id) or type(text) ~= "string" or
        text == "" or #text > state.limits.text or text:find("[%c]") or
        (logical_time ~= nil and not integer(logical_time)) then
      return receipt("rejected", operation_id, "invalid_input")
    end
    if state.grants[actor_id] == nil then
      return receipt("rejected", operation_id, "unknown_actor")
    end
    if pending_count(state, actor_id) >= state.limits.pending_per_actor then
      return receipt("rejected", operation_id, "pending_capacity")
    end
    local entry = append(state, {
      kind = "address", operation_id = operation_id,
      source = {kind = "player", id = player},
      audience = {kind = "actor", id = actor_id}, actor_id = actor_id,
      text = text, logical_time = logical_time, status = "pending",
    })
    if not entry then return receipt("rejected", operation_id, "history_capacity") end
    return receipt("accepted_this_run", operation_id, nil, {
      interaction_id = entry.id, lifecycle = "pending",
    })
  end)
end

local function authorized(spec, actor_id)
  local actors = spec.actors
  if type(actors) ~= "table" then return false end
  if actors[actor_id] == true then return true end
  for _, id in ipairs(actors) do if id == actor_id then return true end end
  return false
end

local function granted_objects(state, actor_id)
  local result = {}
  local grants = state.grants[actor_id] or {}
  for object_id, allowed in pairs(grants) do
    if allowed and state.definitions[object_id] then
      local object_state = state.object_states[object_id]
      local definition, transitions = state.definitions[object_id], {}
      for id, transition in pairs(definition.transitions or {}) do
        if transition.from == object_state.state and authorized(transition, actor_id) then
          transitions[#transitions + 1] = {id=id, from=transition.from,
            to=transition.to, expected_revision=object_state.revision}
        end
      end
      table.sort(transitions, function(a, b) return a.id < b.id end)
      result[#result + 1] = {id = object_id, state=object_state.state,
        revision = object_state.revision, facets = facets_for(definition, object_state),
        transitions=transitions}
    end
  end
  table.sort(result, function(a, b) return a.id < b.id end)
  return result
end

function M.actor_view(state, actor_id, decision_id)
  if not nonempty(actor_id) or state.grants[actor_id] == nil or not nonempty(decision_id) then
    return nil, "invalid_actor_or_decision"
  end
  for old_id, old_offer in pairs(state.offers) do
    if old_offer.actor_id == actor_id and old_id ~= decision_id then state.offers[old_id] = nil end
  end
  local offer = state.offers[decision_id]
  if offer and offer.actor_id ~= actor_id then return nil, "decision_conflict" end
  if not offer then
    local ids = {}
    for _, entry in ipairs(state.interactions) do
      if entry.kind == "address" and entry.actor_id == actor_id and
          entry.status ~= "answered" and #ids < state.limits.context then
        ids[#ids + 1] = entry.id
      end
    end
    if #ids == 0 then
      return {actor_id=actor_id, decision_id=decision_id, messages={},
        offered_conversations={}, granted_objects=granted_objects(state, actor_id)}
    end
    if count(state.offers) >= state.limits.offers then return nil, "offer_capacity" end
    offer = {actor_id = actor_id, conversation_ids = ids}
    state.offers[decision_id] = offer
  end
  local messages = {}
  for _, id in ipairs(offer.conversation_ids) do
    local entry = interaction_by_id(state, id)
    if entry and entry.status ~= "answered" then
      messages[#messages + 1] = {
        id = entry.id, text = entry.text, status = entry.status,
        source = {kind = "player_message", player_id = entry.source.id},
        audience = {kind = "actor", id = actor_id},
        epistemic = "claim", logical_time = entry.logical_time,
      }
    end
  end
  return {actor_id = actor_id, decision_id = decision_id, messages = messages,
    offered_conversations = copy(offer.conversation_ids),
    granted_objects = granted_objects(state, actor_id)}
end

local function offered(state, actor_id, decision_id, conversation_id)
  local offer = state.offers[decision_id]
  if not offer or offer.actor_id ~= actor_id then return false end
  for _, id in ipairs(offer.conversation_ids) do
    if id == conversation_id then return true end
  end
  return false
end

-- A successful decision may acknowledge exact offered inputs. It never answers
-- them; answering requires a separate private reply referencing one input.
function M.commit_actor_result(state, operation_id, actor_id, decision_id, input_ids, successful)
  local payload = {kind = "actor_result", actor_id = actor_id,
    decision_id = decision_id, input_ids = input_ids, successful = successful}
  return execute(state, operation_id, payload, function()
    local n = array_size(input_ids)
    if not n or not nonempty(actor_id) or not nonempty(decision_id) or
        type(successful) ~= "boolean" then
      return receipt("rejected", operation_id, "invalid_input")
    end
    local seen = {}
    for i = 1, n do
      local id = input_ids[i]
      if seen[id] or not offered(state, actor_id, decision_id, id) then
        return receipt("rejected", operation_id, "not_offered")
      end
      seen[id] = true
    end
    if not successful then return receipt("rejected", operation_id, "decision_failed") end
    for i = 1, n do
      local entry = interaction_by_id(state, input_ids[i])
      if entry.status == "pending" then entry.status = "observed" end
    end
    state.offers[decision_id] = nil
    return receipt("accepted_this_run", operation_id, nil, {observed_ids = input_ids})
  end)
end

function M.apply_reply(state, operation_id, actor_id, conversation_id, text, decision_id)
  local payload = {kind = "reply", actor_id = actor_id,
    conversation_id = conversation_id, text = text, decision_id = decision_id}
  return execute(state, operation_id, payload, function()
    if not nonempty(actor_id) or not nonempty(decision_id) or
        type(text) ~= "string" or text == "" or #text > state.limits.text or text:find("[%c]") then
      return receipt("rejected", operation_id, "invalid_input")
    end
    if not offered(state, actor_id, decision_id, conversation_id) then
      return receipt("rejected", operation_id, "not_offered")
    end
    local parent = interaction_by_id(state, conversation_id)
    if not parent or parent.kind ~= "address" or parent.status == "answered" then
      return receipt("rejected", operation_id, "already_answered")
    end
    local entry = append(state, {
      kind = "reply", operation_id = operation_id,
      source = {kind = "actor", id = actor_id},
      audience = {kind = "player", id = parent.source.id},
      text = text, decision_id = decision_id, caused_by = conversation_id,
    })
    if not entry then return receipt("rejected", operation_id, "history_capacity") end
    parent.status = "answered"
    parent.reply_id = entry.id
    return receipt("accepted_this_run", operation_id, nil, {
      interaction_id = entry.id, answered_id = conversation_id,
      recipient_player = parent.source.id,
    })
  end)
end

function M.reduce_object(state, operation_id, actor_id, object_id, transition_id, expected_revision)
  local payload = {kind = "object_transition", actor_id = actor_id,
    object_id = object_id, transition_id = transition_id,
    expected_revision = expected_revision}
  return execute(state, operation_id, payload, function()
    if not nonempty(actor_id) or not nonempty(object_id) or
        not nonempty(transition_id) or not integer(expected_revision) then
      return receipt("rejected", operation_id, "invalid_input")
    end
    local definition, object_state = state.definitions[object_id], state.object_states[object_id]
    if not definition then return receipt("rejected", operation_id, "unknown_object") end
    local spec = (definition.transitions or {})[transition_id]
    if type(spec) ~= "table" or not authorized(spec, actor_id) then
      return receipt("rejected", operation_id, "transition_forbidden")
    end
    if object_state.revision ~= expected_revision then
      return receipt("rejected", operation_id, "revision_conflict")
    end
    if spec.from ~= object_state.state or type(spec.to) ~= "string" then
      return receipt("rejected", operation_id, "transition_unavailable")
    end
    local entry = append(state, {
      kind = "object_transition", operation_id = operation_id,
      source = {kind = "actor", id = actor_id},
      audience = {kind = "public"}, object_id = object_id,
      transition_id = transition_id, revision = object_state.revision + 1,
    })
    if not entry then return receipt("rejected", operation_id, "history_capacity") end
    object_state.revision = entry.revision
    object_state.state = spec.to
    return receipt("accepted_this_run", operation_id, nil, {
      interaction_id = entry.id, object_id = object_id, revision = entry.revision,
    })
  end)
end

function M.player_view(state, player_id, cursor)
  assert(nonempty(player_id), "player id required")
  cursor = cursor or 0
  assert(integer(cursor), "invalid notebook cursor")
  local all = {}
  for _, entry in ipairs(state.interactions) do
    if (entry.source.kind == "player" and entry.source.id == player_id) or
        (entry.audience.kind == "player" and entry.audience.id == player_id) then
      all[#all + 1] = copy(entry)
    end
  end
  local items = {}
  for i = cursor + 1, math.min(#all, cursor + state.limits.page) do
    items[#items + 1] = all[i]
  end
  return {items = items, next_cursor = cursor + #items,
    has_more = cursor + #items < #all}
end

function M.object_view(state, object_id)
  local definition, object_state = state.definitions[object_id], state.object_states[object_id]
  if not definition or not object_state then return nil end
  return {id=object_id, state=object_state.state, revision=object_state.revision,
    facets=facets_for(definition, object_state),
    render_node=definition.render_by_state and definition.render_by_state[object_state.state]}
end

function M.render_node(state, object_id)
  local view = M.object_view(state, object_id)
  return view and view.render_node or nil
end

-- Public projection deliberately omits private text, facet content, player
-- identities, actor identities, operation IDs and hidden object transitions.
function M.public_view(state)
  local objects, transitions = {}, {}
  for id, definition in pairs(state.definitions) do
    if definition.public == true then
      objects[#objects + 1] = {id = id, revision = state.object_states[id].revision}
    end
  end
  table.sort(objects, function(a, b) return a.id < b.id end)
  for _, entry in ipairs(state.interactions) do
    local definition = state.definitions[entry.object_id]
    if entry.kind == "object_transition" and definition and definition.public == true then
      transitions[#transitions + 1] = {kind = "object_transition",
        object_id = entry.object_id, revision = entry.revision}
    end
  end
  return {version = state.version, objects = objects, transitions = transitions}
end

function M.export(state)
  return {version = state.version, world_id = state.world_id,
    origin_event_id = state.origin_event_id, sequence = state.sequence,
    object_states = copy(state.object_states), interactions = copy(state.interactions),
    operations = copy(state.operations), offers = copy(state.offers),
    limits = copy(state.limits)}
end

function M.load(snapshot, origin_objects, actor_grants, options)
  assert(type(snapshot) == "table" and snapshot.version == 1,
    "unsupported narrative snapshot")
  local state = fresh(origin_objects, actor_grants, options)
  -- Luanti's JSON decoder maps serialized empty Lua tables to nil. Restore
  -- those fields as empty collections before validating their contents.
  local saved_interactions = snapshot.interactions
  local saved_object_states = snapshot.object_states
  local saved_operations = snapshot.operations
  local saved_offers = snapshot.offers
  if saved_interactions == nil then saved_interactions = {} end
  if saved_object_states == nil then saved_object_states = {} end
  if saved_operations == nil then saved_operations = {} end
  if saved_offers == nil then saved_offers = {} end
  assert(snapshot.world_id == state.world_id and
    snapshot.origin_event_id == state.origin_event_id, "narrative origin mismatch")
  assert(canonical(snapshot.limits) == canonical(state.limits), "narrative limits mismatch")
  assert(integer(snapshot.sequence) and array_size(saved_interactions) == snapshot.sequence,
    "invalid narrative sequence")
  assert(type(saved_object_states) == "table" and
    count(saved_object_states) == count(state.object_states), "invalid object states")
  local transition_counts = {}
  for id, initial in pairs(state.object_states) do
    local value = saved_object_states[id]
    local allowed_states = {}
    for _, object_state in ipairs(state.definitions[id].states or {}) do
      allowed_states[object_state] = true
    end
    assert(type(value) == "table" and integer(value.revision) and
      allowed_states[value.state] and
      (value.revision > 0 or value.state == initial.state), "invalid object state")
    transition_counts[id] = 0
  end
  assert(type(saved_operations) == "table" and
    count(saved_operations) <= state.limits.operations, "invalid operation ledger")
  assert(type(saved_offers) == "table" and
    count(saved_offers) <= state.limits.offers, "invalid decision offers")
  assert(snapshot.sequence <= state.limits.interactions, "narrative history capacity exceeded")
  local interactions = {}
  for i, entry in ipairs(saved_interactions) do
    assert(type(entry) == "table" and entry.id == "story:" .. i and
      entry.sequence == i and type(entry.source) == "table" and
      nonempty(entry.source.kind) and nonempty(entry.source.id) and
      type(entry.audience) == "table" and nonempty(entry.audience.kind)
      and nonempty(entry.audience.id or "public"), "invalid narrative interaction")
    assert(entry.kind == "inspect" or entry.kind == "address" or
      entry.kind == "reply" or entry.kind == "object_transition", "invalid interaction kind")
    if entry.kind == "inspect" then
      assert(entry.source.kind == "player" and entry.audience.kind == "player" and
        entry.source.id == entry.audience.id and state.definitions[entry.object_id] and
        integer(entry.revision) and array_size(entry.facets), "invalid inspection record")
    elseif entry.kind == "address" then
      assert(entry.source.kind == "player" and entry.audience.kind == "actor" and
        state.grants[entry.actor_id] and entry.audience.id == entry.actor_id and
        type(entry.text) == "string" and #entry.text <= state.limits.text and
        (entry.status == "pending" or entry.status == "observed" or entry.status == "answered"),
        "invalid player message")
    elseif entry.kind == "reply" then
      assert(entry.source.kind == "actor" and entry.audience.kind == "player" and
        type(entry.text) == "string" and #entry.text <= state.limits.text and
        nonempty(entry.caused_by), "invalid private reply")
    else
      assert(entry.source.kind == "actor" and entry.audience.kind == "public" and
        state.definitions[entry.object_id] and nonempty(entry.transition_id) and
        integer(entry.revision), "invalid object transition record")
      transition_counts[entry.object_id] = transition_counts[entry.object_id] + 1
    end
    interactions[entry.id] = entry
  end
  for id, object_state in pairs(saved_object_states) do
    assert(object_state.revision == transition_counts[id], "object revision/history mismatch")
  end
  for _, entry in ipairs(saved_interactions) do
    if entry.kind == "address" and entry.status == "answered" then
      local reply = interactions[entry.reply_id]
      assert(reply and reply.kind == "reply" and reply.caused_by == entry.id
        and reply.audience.id == entry.source.id, "answered message has no matching reply")
    elseif entry.kind == "reply" then
      local parent = interactions[entry.caused_by]
      assert(parent and parent.kind == "address" and parent.reply_id == entry.id,
        "reply parent does not match")
    end
  end
  for operation_id, operation in pairs(saved_operations) do
    assert(nonempty(operation_id) and type(operation) == "table" and
      type(operation.payload) == "string" and #operation.payload <= 32768 and
      type(operation.receipt) == "table" and operation.receipt.operation_id == operation_id and
      type(operation.receipt.status) == "string" and type(operation.receipt.checkpointed) == "boolean",
      "invalid narrative operation")
  end
  for decision_id, offer in pairs(saved_offers) do
    assert(nonempty(decision_id) and type(offer) == "table" and state.grants[offer.actor_id]
      and array_size(offer.conversation_ids), "invalid narrative decision offer")
    local seen = {}
    for _, conversation_id in ipairs(offer.conversation_ids) do
      local message = interactions[conversation_id]
      assert(not seen[conversation_id] and message and message.kind == "address"
        and message.actor_id == offer.actor_id, "invalid offered conversation")
      seen[conversation_id] = true
    end
  end
  state.sequence = snapshot.sequence
  state.object_states = copy(saved_object_states)
  state.interactions = copy(saved_interactions)
  state.operations = copy(saved_operations)
  state.offers = copy(saved_offers)
  for _, operation in pairs(state.operations) do
    if type(operation) == "table" and type(operation.receipt) == "table" then
      operation.receipt.checkpointed = true
    end
  end
  return state
end

return M
