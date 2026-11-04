-- Public Genesis facts for role-specific model envelopes.
local M = {}

function M.public_world_fact(manifest, actor_id)
  assert(type(manifest) == 'table' and type(manifest.public) == 'table',
    'public Genesis projection required')
  assert(type(manifest.origin_event_id) == 'string' and manifest.origin_event_id ~= '',
    'Genesis origin required')
  assert(type(actor_id) == 'string' and actor_id ~= '', 'actor id required')
  local title = manifest.public.title
  local description = manifest.public.description
  assert(type(title) == 'string' and title ~= '', 'public world title required')
  if description ~= nil then
    assert(type(description) == 'string', 'public world description must be text')
  else
    description = '' -- Compatibility with manifests created before this projection existed.
  end
  local text = 'World: ' .. title
  if description ~= '' then text = text .. '. ' .. description end
  assert(#text <= 4096, 'public world context exceeds model-input limit')
  return {
    id = 'genesis:world:' .. manifest.origin_event_id,
    text = text,
    source = {kind = 'genesis.public', id = manifest.origin_event_id},
    scope = 'public', audience = {actor_id},
  }
end

local function integer_coord(value, name)
  assert(type(value) == 'number' and value == math.floor(value)
    and value >= -64 and value <= 64, name .. ' must be an integer coordinate')
  return value
end

function M.public_places(manifest)
  assert(type(manifest) == 'table' and type(manifest.public) == 'table',
    'public Genesis projection required')
  local places = manifest.public.places or {}
  assert(type(places) == 'table', 'public places required')
  local ordered = {}
  for index, place in ipairs(places) do
    assert(type(place) == 'table', 'public place required')
    ordered[index] = place
  end
  table.sort(ordered, function(a, b)
    assert(type(a.id) == 'string' and type(b.id) == 'string', 'place id required')
    return a.id < b.id
  end)
  local listed = {}
  for _, place in ipairs(ordered) do
    assert(type(place.id) == 'string' and place.id ~= '', 'place id required')
    assert(type(place.name) == 'string' and place.name ~= '', 'place name required')
    assert(place.space == 'indoor' or place.space == 'outdoor', 'place space required')
    local anchor = place.anchor
    assert(type(anchor) == 'table', 'place anchor required')
    local point = {
      x = integer_coord(anchor.x, 'place x'),
      y = integer_coord(anchor.y, 'place y'),
      z = integer_coord(anchor.z, 'place z'),
    }
    listed[#listed + 1] = {id = place.id, name = place.name, space = place.space, point = point}
  end
  return listed
end

function M.public_place_facts(manifest, actor_id)
  assert(type(actor_id) == 'string' and actor_id ~= '', 'actor id required')
  local facts = {}
  local by_id = {}
  for _, place in ipairs(manifest.public.places or {}) do
    if type(place) == 'table' and type(place.id) == 'string' then by_id[place.id] = place end
  end
  for _, place in ipairs(M.public_places(manifest)) do
    local description = by_id[place.id] and by_id[place.id].description or ''
    if description == nil then description = '' end
    assert(type(description) == 'string', 'place description must be text')
    local point = place.point
    local text = string.format('Place %s (%s) is %s. A standable point is x=%d, y=%d, z=%d.',
      place.name, place.id, place.space, point.x, point.y, point.z)
    if description ~= '' then text = text .. ' ' .. description end
    assert(#text <= 4096, 'public place context exceeds model-input limit')
    facts[#facts + 1] = {
      id = 'genesis:place:' .. manifest.origin_event_id .. ':' .. place.id,
      text = text,
      source = {kind = 'genesis.public', id = manifest.origin_event_id},
      scope = 'public', audience = {actor_id},
    }
  end
  return facts
end

return M
