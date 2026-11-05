-- Authenticated Luanti boundary for private story interactions and public
-- object changes. Narrative facts remain in world/narrative_state.lua.
local M = {}

local function key(position)
  return tostring(position.x) .. "," .. tostring(position.y) .. "," .. tostring(position.z)
end

local function distance_squared(a, b)
  local x, y, z = a.x-b.x, a.y-b.y, a.z-b.z
  return x*x + y*y + z*z
end

local function player_name(player)
  if not player or type(player.is_player) ~= "function" or not player:is_player() then return nil end
  return player:get_player_name()
end

local function escape(engine, value)
  value = tostring(value or "")
  if engine.formspec_escape then return engine.formspec_escape(value) end
  return value:gsub("\\", "\\\\"):gsub("%[", "\\["):gsub("%]", "\\]")
    :gsub(";", "\\;"):gsub(",", "\\,")
end

function M.new(engine, narrative, manifest, options)
  assert(type(engine) == "table" and type(narrative) == "table" and
    type(manifest) == "table" and type(options) == "table", "invalid story runtime dependencies")
  local public_objects, private_objects, actors = {}, manifest.private_objects or {}, {}
  for _, object in ipairs(manifest.public.objects or {}) do
    assert(type(object.id) == "string" and not public_objects[object.id], "duplicate public story object")
    public_objects[object.id] = object
  end
  for _, actor in ipairs(manifest.actors or {}) do actors[actor.actor_id] = actor end
  local runtime = {state=narrative.new_from_manifest(manifest), tickets={}, counter=0}

  function runtime:load(snapshot)
    self.state = narrative.load_from_manifest(snapshot, manifest)
    return self.state
  end
  function runtime:export()
    return narrative.export(self.state)
  end
  function runtime:actor_view(actor_id, decision_id, actor_position)
    local view, reason = narrative.actor_view(self.state, actor_id, decision_id)
    if not view or not actor_position then return view, reason end
    local visible = {}
    for _, object in ipairs(view.granted_objects) do
      local binding, spec = public_objects[object.id], private_objects[object.id]
      local reach = spec and spec.reach or 0
      if binding and distance_squared(actor_position, binding.position) <= reach * reach then
        visible[#visible + 1] = object
      end
    end
    view.granted_objects = visible
    return view
  end
  function runtime:commit_actor_result(operation_id, actor_id, decision_id, input_ids, successful)
    return narrative.commit_actor_result(self.state, operation_id, actor_id, decision_id,
      input_ids, successful)
  end
  function runtime:object_view(object_id)
    return narrative.object_view(self.state, object_id)
  end
  function runtime:projected_node(operation)
    if not operation.object_id then return operation.value and operation.value.name end
    return narrative.render_node(self.state, operation.object_id)
      or operation.value and operation.value.name
  end
  function runtime:bind_node(operation)
    if not operation.object_id then return true end
    local meta = engine.get_meta(operation.position)
    if not meta then return false end
    meta:set_string("wispiva_story_object", operation.object_id)
    meta:set_string("wispiva_story_place", operation.place_id or "")
    local view = narrative.object_view(self.state, operation.object_id)
    if view then meta:set_string("wispiva_story_revision", tostring(view.revision)) end
    return meta:get_string("wispiva_story_object") == operation.object_id
      and meta:get_string("wispiva_story_place") == (operation.place_id or "")
  end
  function runtime:verify_node(operation, actual)
    if not operation.object_id then return false end
    local meta = engine.get_meta(operation.position)
    local view = narrative.object_view(self.state, operation.object_id)
    return actual and actual.name == self:projected_node(operation) and meta and view
      and meta:get_string("wispiva_story_object") == operation.object_id
      and meta:get_string("wispiva_story_place") == operation.place_id
      and (meta:get_string("wispiva_story_revision") == "" or
        tonumber(meta:get_string("wispiva_story_revision")) == view.revision)
  end
  function runtime:update_object_node(object_id)
    local object, view = public_objects[object_id], narrative.object_view(self.state, object_id)
    if not object or not view or not view.render_node then return false, "render_missing" end
    local current = engine.get_node(object.position)
    local meta = engine.get_meta(object.position)
    if not current or not meta or meta:get_string("wispiva_story_object") ~= object_id then
      return false, "object_binding_missing"
    end
    if current.name ~= view.render_node then
      engine.swap_node(object.position, {name=view.render_node, param2=current.param2 or 0})
    end
    meta = engine.get_meta(object.position)
    meta:set_string("wispiva_story_object", object_id)
    meta:set_string("wispiva_story_place", object.place_id)
    meta:set_string("wispiva_story_revision", tostring(view.revision))
    current = engine.get_node(object.position)
    if current.name ~= view.render_node or
        meta:get_string("wispiva_story_object") ~= object_id or
        tonumber(meta:get_string("wispiva_story_revision")) ~= view.revision then
      return false, "object_render_unverified"
    end
    return true
  end

  local function current_actor(actor_id)
    return options.actor_lookup and options.actor_lookup(actor_id) or nil
  end
  local function ticket_for(name, kind, id, reach)
    runtime.counter = runtime.counter + 1
    local stamp = tostring(engine.get_us_time and engine.get_us_time() or os.time())
    local seed = table.concat({name, kind, id, stamp, tostring(runtime.counter), tostring({})}, ":")
    local token = engine.sha1 and engine.sha1(seed) or seed:gsub("[^%w]", ""):sub(1, 64)
    local ticket = {token=token, player=name, kind=kind, id=id,
      operation_id="player:" .. token, expires=(os.time() + 300), reach=reach}
    runtime.tickets[name] = ticket
    return ticket
  end
  local function send(player, text)
    local name = player_name(player)
    if name then engine.chat_send_player(name, "[Wispiva] " .. text) end
  end
  local function in_range(player, ticket)
    local here = player:get_pos()
    if not here then return false end
    local target
    if ticket.kind == "object" then
      target = public_objects[ticket.id] and public_objects[ticket.id].position
    else
      local actor = current_actor(ticket.id)
      target = actor and actor.object and actor.object:get_pos()
    end
    if not target then return false end
    return distance_squared(here, target) <= ticket.reach * ticket.reach
  end

  local function object_at(position)
    for object_id, object in pairs(public_objects) do
      if key(position) == key(object.position) then return object_id, object end
    end
  end
  function runtime:show_object(position, player)
    local name = player_name(player)
    if not name then return false end
    local object_id, object = object_at(position)
    local private = object_id and private_objects[object_id]
    local view = object_id and narrative.object_view(self.state, object_id)
    if not object or not private or not view or not self:verify_node(
        {object_id=object_id, place_id=object.place_id, position=object.position},
        engine.get_node(position)) then
      send(player, "这个故事物件与世界记录不一致，暂时无法调查。")
      return false
    end
    local ticket = ticket_for(name, "object", object_id, private.reach)
    local parts = {object.label or object_id, "状态：" .. view.state}
    for _, facet in ipairs(view.facets or {}) do
      parts[#parts + 1] = facet.text .. "\n依据：" .. facet.sourceRef .. "（" .. facet.epistemic .. "）"
    end
    local form = "formspec_version[4]size[9,6]label[0.4,0.25;" .. escape(engine, object.label or object_id) .. "]"
      .. "textarea[0.4,0.65;8.2,3.75;story_read;调查记录;" .. escape(engine, table.concat(parts, "\n\n")) .. "]"
      .. "button[0.5,4.8;2.6,0.7;record;调查并记录]"
      .. "button[3.3,4.8;2.2,0.7;journal;打开调查簿]"
      .. "button_exit[6.5,4.8;2.0,0.7;close;关闭]"
    engine.show_formspec(name, "wispiva:story:" .. ticket.token, form)
    return true
  end

  function runtime:show_actor(actor_entity, player)
    local name, actor_id = player_name(player), actor_entity and actor_entity._actor_id
    if not name or type(actor_id) ~= "string" or not actor_entity.object then return false end
    local pos, player_pos = actor_entity.object:get_pos(), player:get_pos()
    if not pos or not player_pos or distance_squared(pos, player_pos) > 36 then
      send(player, "请靠近角色后再交谈。")
      return false
    end
    local actor = actors[actor_id]
    if not actor then return false end
    local ticket = ticket_for(name, "actor", actor_id, 6)
    local form = "formspec_version[4]size[9,4]label[0.4,0.3;与 " .. escape(engine, actor.name) .. " 私下交谈]"
      .. "label[0.4,0.8;你的话只会交给这名角色；对方是否回应取决于后续决策。]"
      .. "field_close_on_enter[message;false]field[0.5,1.7;8.0,0.8;message;写一句话;]"
      .. "button[2.0,2.8;2.4,0.7;send;送出]button_exit[4.7,2.8;2.4,0.7;close;关闭]"
    engine.show_formspec(name, "wispiva:story:" .. ticket.token, form)
    return true
  end

  function runtime:open_journal(player)
    local name = player_name(player)
    if not name then return false end
    local page = narrative.player_view(self.state, name)
    local lines = {}
    for _, entry in ipairs(page.items) do
      if entry.kind == "inspect" then
        for _, facet in ipairs(entry.facets or {}) do
          lines[#lines + 1] = "调查 · " .. tostring(entry.object_id) .. " · " .. tostring(facet.epistemic)
          lines[#lines + 1] = facet.text .. "\n依据：" .. facet.sourceRef
        end
      elseif entry.kind == "address" then
        lines[#lines + 1] = "你对 " .. tostring(actors[entry.actor_id] and actors[entry.actor_id].name or entry.actor_id)
          .. " 说：“" .. entry.text .. "” · " .. entry.status
      elseif entry.kind == "reply" then
        lines[#lines + 1] = tostring(actors[entry.source.id] and actors[entry.source.id].name or entry.source.id)
          .. " 私下回应：“" .. entry.text .. "”"
      end
    end
    local body = #lines > 0 and table.concat(lines, "\n\n") or "调查簿还是空的。右键场景物件调查，或靠近角色开始交谈。"
    engine.show_formspec(name, "wispiva:story_journal",
      "formspec_version[4]size[9,6]textarea[0.3,0.3;8.4,5.0;journal;调查簿;" .. escape(engine, body) .. "]"
        .. "button_exit[3.2,5.3;2.6,0.6;close;关闭]")
    return true
  end

  local function reason_text(reason)
    return ({unknown_object="找不到这件物件", pending_capacity="角色的待处理消息已满",
      history_capacity="调查记录已满", operation_capacity="交互额度已满",
      operation_conflict="提交内容与原操作不一致", invalid_input="输入格式不正确"})[reason]
      or "操作未接受（" .. tostring(reason or "unknown") .. "）。"
  end
  function runtime:handle_fields(player, formname, fields)
    local name = player_name(player)
    if formname == "wispiva:story_journal" then return true end
    local token = type(formname) == "string" and formname:match("^wispiva:story:(%x+)$")
    local ticket = name and self.tickets[name]
    if not ticket or not token or ticket.token ~= token or ticket.player ~= name then return false end
    if fields.quit or fields.close then self.tickets[name] = nil; return true end
    if os.time() > ticket.expires or not in_range(player, ticket) then
      self.tickets[name] = nil
      send(player, "交互已过期或距离太远，请重新靠近后操作。")
      return true
    end
    if ticket.kind == "object" and fields.record then
      local receipt = narrative.inspect(self.state, ticket.operation_id .. ":inspect", name,
        ticket.id, options.logical_time and options.logical_time() or 0)
      if receipt.status == "accepted_this_run" then
        send(player, "已记录调查结果。来源与推断类型见调查簿。")
      elseif receipt.status == "already_discovered" then
        send(player, "这条线索已在调查簿中。")
      else send(player, reason_text(receipt.reason)) end
      self.tickets[name] = nil
      return true
    elseif ticket.kind == "actor" and fields.send then
      local text = fields.message
      local receipt = narrative.address(self.state, ticket.operation_id .. ":address", name,
        ticket.id, text, options.logical_time and options.logical_time() or 0)
      if receipt.status == "accepted_this_run" then
        send(player, "消息已私下交给角色；是否回应取决于后续角色决策。")
      else send(player, reason_text(receipt.reason)) end
      self.tickets[name] = nil
      return true
    elseif ticket.kind == "object" and fields.journal then
      self.tickets[name] = nil
      self:open_journal(player)
      return true
    end
    return true
  end

  function runtime:apply_action(actor_id, decision_id, action)
    if action.kind == "reply_player" then
      local operation_id = decision_id .. ":reply:" .. tostring(action.conversation_id)
      local receipt = narrative.apply_reply(self.state, operation_id, actor_id,
        action.conversation_id, action.text, decision_id)
      if receipt.status ~= "accepted_this_run" then return false, receipt.reason end
      local player_id = receipt.recipient_player
      if player_id and engine.get_player_by_name then
        local player = engine.get_player_by_name(player_id)
        if player then send(player, "角色私下回应：“" .. action.text .. "”") end
      end
      return true, "private-reply", receipt
    elseif action.kind == "continue_story_object" then
      local actor, binding, spec = current_actor(actor_id), public_objects[action.object_id],
        private_objects[action.object_id]
      local actor_position = actor and actor.object and actor.object:get_pos()
      if not actor_position or not binding or not spec or
          distance_squared(actor_position, binding.position) > spec.reach * spec.reach then
        return false, "out_of_reach"
      end
      local operation_id = decision_id .. ":object:" .. action.object_id .. ":" .. action.transition_id
      local receipt = narrative.reduce_object(self.state, operation_id, actor_id,
        action.object_id, action.transition_id, action.expected_revision)
      if receipt.status ~= "accepted_this_run" then return false, receipt.reason end
      local ok, reason = self:update_object_node(action.object_id)
      if not ok then
        if options.on_error then options.on_error("story-object-render", reason) end
        return false, reason
      end
      if options.on_public_transition then options.on_public_transition(action.object_id, receipt) end
      return true, "world-object-changed", receipt
    end
    return false, "unknown_story_action"
  end

  if engine.register_chatcommand then
    local function journal_command(name)
      local player = engine.get_player_by_name(name)
      if player then runtime:open_journal(player) end
      return true, "调查簿已打开。"
    end
    engine.register_chatcommand("journal", {description="查看 Wispiva 调查簿", func=journal_command})
    engine.register_chatcommand("wispiva_journal", {description="查看 Wispiva 调查簿", func=journal_command})
  end
  return runtime
end

return M
