-- Pure bounded spatial projection used by the product init.lua and its
-- read-before-write origin projection. It is still not a general map adapter.
-- Input is the caller-authenticated genesis.world_create persistent manifest:
-- {format='wispiva-world-manifest', version=1 or 2, world_id, origin_event_id,
-- public={places, semantic_connections, actors, objects?}}. Places may carry
-- a bounded narrative scene recipe (fixed shell, palette and semantic furniture).
-- Manifest v2 is the publication ledger hand-off and also carries operation_id.
-- Private fields such as origin_draft are ignored here. Places/actors use genesis.compiler's
-- public fields (anchor, space; actor_id, ordinal, place_id, position). Objects
-- are {id, place_id, position, node}; supported interactive nodes are listed below.
-- Private goals/memories are never copied. The caller must verify this manifest
-- against the committed origin, authenticate/authorize it, and hold exclusive
-- world access with readers frozen throughout application and recovery.
--
-- Adapter contract (plain functions, no implicit self): binding() returns
-- {world_id, origin_event_id}; read(op) returns false for KNOWN empty, an exact
-- op.value for already projected, or nil for unknown/unloaded/uninspectable.
-- For node ops empty means air WITH no metadata/timer/inventory; ignore is unknown.
-- For actor ops inspect the durable actor_id registry, not just nearby entities;
-- absence is empty only when proven. write(op) places a node or durably upserts
-- an actor with its stable key. Reads must reflect actual state including any
-- metadata, timers, inventories or actor movement; never return a cached receipt.
-- An op with value=false only checks clearance and never writes/clears terrain.
-- This module does not register nodes/entities, emerge terrain or start Luanti.
-- There is no cross-store transaction: errors may leave a known partial prefix.
-- Retry the SAME origin while frozen; unknown or divergent state requires review.
local M = {}
local interactive = {['default:chest'] = true, ['default:furnace'] = true,
  ['society:story_notice'] = true, ['society:story_surface'] = true,
  ['society:story_surface_disturbed'] = true}
-- Nodes that exist in minetest_game's default mod. Absent fields keep wood.
local build_nodes = {
  ['default:wood'] = true, ['default:bookshelf'] = true, ['default:glass'] = true,
  ['default:stonebrick'] = true, ['default:stone'] = true, ['default:cobble'] = true,
  ['default:brick'] = true,
}

local function check(ok, message)
  assert(ok, 'world projection: ' .. message)
end
local function integer(v, low, high)
  return type(v) == 'number' and v == math.floor(v) and v >= low and v <= high
end
local function id(v)
  return type(v) == 'string' and #v <= 80 and v:match('^[%w_:%-]+$') ~= nil
end
local function uuid(v)
  return type(v) == 'string' and #v == 36
    and v:match('^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$')
    and v == v:lower()
end
local function array(t, limit)
  check(type(t) == 'table', 'array required')
  local n = 0
  for k in pairs(t) do
    check(integer(k, 1, limit), 'invalid array index'); n = n + 1
  end
  for i = 1, n do check(t[i] ~= nil, 'sparse array') end
  return n
end
local function position(p)
  check(type(p) == 'table' and integer(p.x, -64, 64)
    and integer(p.z, -64, 64) and integer(p.y, -7, 1), 'invalid position')
  return {x=p.x, y=p.y, z=p.z}
end
local function point(x, y, z) return {x=x, y=y, z=z} end
local function key(p) return p.x .. ',' .. p.y .. ',' .. p.z end
local function equal(a, b)
  if type(a) ~= type(b) then return false end
  if type(a) ~= 'table' then return a == b end
  for k, v in pairs(a) do if not equal(v, b[k]) then return false end end
  for k in pairs(b) do if a[k] == nil then return false end end
  return true
end
local function copy(v)
  if type(v) ~= 'table' then return v end
  local out = {}; for k, item in pairs(v) do out[k] = copy(item) end
  return out
end

-- A reusable, versioned furnished-room blueprint. Coordinates are relative to
-- the public anchor; the story chooses it in its draft, never by place name.
local function sitting_room(p, node)
  local base = p.y - 1
  local function put(x,y,z,name,rotation)
    node(point(p.x+x,base+y,p.z+z), 'society:' .. name, rotation)
  end
  for x=-5,5 do
    for z=-4,4 do
      put(x,0,z,'parquet')
      for y=1,4 do
        local wall = math.abs(x)==5 or math.abs(z)==4
        local door = x==5 and z==-2 and y<=2
        if wall and not door then
          put(x,y,z,y==1 and 'panelling' or (y==4 and 'cornice' or 'wallpaper'))
        else
          node(point(p.x+x,base+y,p.z+z),nil)
        end
      end
      put(x,5,z,'plaster')
    end
  end
  for x=-3,3 do
    for z=-2,1 do
      local side_x, side_z = math.abs(x)==3, z==-2 or z==1
      local name, rotation = 'rug_center', 0
      if side_x and side_z then
        name = 'rug_corner'
        if x==-3 and z==-2 then rotation=0
        elseif x==-3 then rotation=1
        elseif z==1 then rotation=2 else rotation=3 end
      elseif side_x or side_z then
        name = 'rug_edge'
        rotation = z==-2 and 0 or (x==-3 and 1 or (z==1 and 2 or 3))
      end
      put(x,0,z,name,rotation)
    end
  end
  for z=-1,0 do
    for y=2,3 do put(-5,y,z,'sash_window',1) end
  end
  for _,z in ipairs({-2,1}) do
    for y=1,3 do put(-4,y,z,'curtain',3) end
  end
  for z=-2,1 do put(-4,4,z,(z==-2 or z==1) and 'curtain_header' or 'curtain_valance',3) end
  for x=-1,1 do
    put(x,0,3,'hearth_stone')
    put(x,2,3,'mantel')
  end
  for _,x in ipairs({-1,1}) do
    put(x,1,3,'fireplace_pier')
  end
  put(0,1,3,'hearth_fire')
  put(0,3,3,'clock')
  put(0,4,3,'large_painting')
  put(-1,1,-1,'coffee_table_paper'); put(1,1,-1,'coffee_table_tea')
  put(0,1,-1,'coffee_table_center')
  put(-2,1,0,'armchair',3); put(2,1,0,'armchair',1)
  for x=3,4 do
    for y=1,3 do put(x,y,3,'bookcase') end
    put(x,4,3,'bookcase_crown')
  end
  put(-3,1,3,'desk'); put(-2,1,3,'desk')
  put(-3,2,3,'green_lamp'); put(-2,2,3,'papers')
  put(-3,1,2,'desk_chair',2)
  put(4,1,1,'settee_left',1); put(4,1,0,'settee_middle',1); put(4,1,-1,'settee_right',1)
  put(-4,1,-1,'side_table')
  put(0,4,0,'ceiling_lamp')
  put(-2,3,3,'wall_lamp'); put(2,3,3,'wall_lamp')
  put(-4,3,2,'painting',3)
  put(4,3,-2,'painting',1)
end

local function scene_room(p, scene, node)
  local palettes = {
    study = {floor='parquet', lower='panelling', wall='wallpaper', trim='cornice', ceiling='plaster'},
    workshop = {floor='walnut', lower='panelling', wall='plaster', trim='plaster', ceiling='plaster'},
    archive = {floor='parquet', lower='walnut', wall='plaster', trim='cornice', ceiling='plaster'},
  }
  local palette = palettes[scene.palette]
  local base = p.y - 1
  local function put(x,y,z,name,rotation)
    node(point(p.x+x,base+y,p.z+z), 'society:' .. name, rotation)
  end
  for x=-5,5 do
    for z=-4,4 do
      put(x,0,z,palette.floor)
      for y=1,4 do
        local wall = math.abs(x)==5 or math.abs(z)==4
        local door = x==5 and z==-2 and y<=2
        if wall and not door then
          local material = y==1 and palette.lower or (y==4 and palette.trim or palette.wall)
          put(x,y,z,material)
        else
          node(point(p.x+x,base+y,p.z+z),nil)
        end
      end
      put(x,5,z,palette.ceiling)
    end
  end
  for z=-1,0 do
    for y=2,3 do put(-5,y,z,'sash_window',1) end
  end
  -- Keep text-authored rooms visibly lit without expanding the model's
  -- furniture vocabulary. Skip wall sconces where a tall bookcase occupies
  -- the same wall cell; the central pendant is always clear by schema.
  put(0,4,0,'ceiling_lamp')
  local occupied_bookcases = {}
  for _, furnishing in ipairs(scene.furnishings) do
    if furnishing.kind == 'bookcase' then
      occupied_bookcases[furnishing.at[1] .. ',' .. furnishing.at[2]] = true
    end
  end
  for _,x in ipairs({-2,2}) do
    if not occupied_bookcases[x .. ',3'] then put(x,3,3,'wall_lamp') end
  end
  local facings = {north=0, east=3, south=2, west=1}
  for _, furnishing in ipairs(scene.furnishings) do
    local x,z = furnishing.at[1], furnishing.at[2]
    local rotation = facings[furnishing.facing]
    local name = ({armchair='armchair', writing_desk='desk', desk_chair='desk_chair',
      bookcase='bookcase', table='coffee_table', side_table='side_table'})[furnishing.kind]
    local height = furnishing.kind == 'bookcase' and 3 or 1
    for y=1,height do put(x,y,z,name,rotation) end
    if furnishing.kind == 'bookcase' then put(x,4,z,'bookcase_crown',rotation) end
  end
end

local function exact_fields(value, expected)
  if type(value) ~= 'table' then return false end
  local count, expected_count = 0, 0
  for key in pairs(value) do
    if not expected[key] then return false end
    count = count + 1
  end
  for key in pairs(expected) do
    expected_count = expected_count + 1
    if value[key] == nil then return false end
  end
  return count == expected_count
end

local function validate_scene(scene)
  check(exact_fields(scene, {version=true, palette=true, furnishings=true})
    and scene.version == 1, 'invalid scene')
  check(scene.palette == 'study' or scene.palette == 'workshop' or scene.palette == 'archive',
    'unsupported scene palette')
  local kinds = {armchair=true, writing_desk=true, desk_chair=true, bookcase=true,
    table=true, side_table=true}
  local facings = {north=true, east=true, south=true, west=true}
  local bases = {stated=true, inferred=true, author=true}
  check(array(scene.furnishings, 8) > 0, 'invalid scene furnishings')
  local occupied = {}
  for _, furnishing in ipairs(scene.furnishings) do
    check(exact_fields(furnishing, {kind=true, at=true, facing=true, basis=true}),
      'invalid scene furnishing')
    check(kinds[furnishing.kind] and facings[furnishing.facing] and bases[furnishing.basis],
      'invalid scene furnishing enum')
    check(array(furnishing.at, 2) == 2
      and integer(furnishing.at[1], -4, 4) and integer(furnishing.at[2], -3, 3),
      'invalid scene furnishing position')
    local x,z = furnishing.at[1], furnishing.at[2]
    local wall_cell = (math.abs(x)==3 and -1<=z and z<=3)
      or (math.abs(z)==3 and -2<=x and x<=2)
    check(wall_cell, 'scene furnishing outside wall-side cells')
    local cell = x .. ',' .. z
    check(not occupied[cell], 'overlapping scene furnishings')
    occupied[cell] = true
  end
end

function M.accept_binding(manifest)
  if type(manifest) ~= 'table' or manifest.format ~= 'wispiva-world-manifest' then return false end
  if manifest.version == 1 then
    if manifest.operation_id ~= nil then return false end
  elseif manifest.version == 2 then
    local operation_id = manifest.operation_id
    if type(operation_id) ~= 'string' or #operation_id ~= 32
      or operation_id:match('^[0-9a-f]+$') == nil then return false end
  else
    return false
  end
  return uuid(manifest.world_id) and id(manifest.origin_event_id) and true or false
end

function M.plan(manifest, options)
  options = options or {}
  local vertical_version = options.legacy_vertical and 1 or options.vertical_version or 3
  check(M.accept_binding(manifest), 'invalid origin binding')
  local view = manifest.public
  check(type(view) == 'table', 'public spatial view required')
  local objects = view.objects
  if objects == nil then objects = {} end -- Current compiler has no objects yet.
  local places, ordered, nodes, actors, occupied = {}, {}, {}, {}, {}
  local vertical_cells = {}
  check(array(view.places, 16) > 0, 'no places')
  array(view.semantic_connections, 64); array(view.actors, 64); array(objects, 64)
  local function node(p, name, param2)
    nodes[key(p)] = {kind='node', key='node:' .. key(p), position=p,
      value=name and {name=name, param2=param2 or 0} or false}
  end
  for _, place in ipairs(view.places) do
    check(type(place) == 'table' and id(place.id) and not places[place.id], 'duplicate/invalid place')
    check(place.space == 'indoor' or place.space == 'outdoor', 'unsupported space')
    local p = position(place.anchor)
    check(p.y == 1 or p.y == -7, 'unsupported place level')
    local detailed = place.blueprint ~= nil or place.scene ~= nil
    check(not (place.blueprint ~= nil and place.scene ~= nil), 'multiple detailed interiors')
    check(place.blueprint == nil or (place.blueprint == 'victorian_sitting_room_v1' and place.space == 'indoor'),
      'unsupported blueprint')
    if place.scene ~= nil then
      check(place.space == 'indoor', 'scene requires indoor place')
      validate_scene(place.scene)
    end
    if detailed then
      for _,field in ipairs({'floor','wall','ceiling','apron','windows'}) do
        check(place[field] == nil, 'blueprint material override')
      end
    end
    local radius = detailed and 5 or (place.space == 'indoor' and 3 or 2)
    local depth = detailed and 4 or radius
    if detailed then check(math.abs(p.x)+radius <= 32 and math.abs(p.z)+depth <= 32, 'blueprint outside bounds') end
    for _, other in ipairs(ordered) do
      if p.y == other.anchor.y then
        check(math.abs(p.x-other.anchor.x) > radius+other.radius
          or math.abs(p.z-other.anchor.z) > depth+other.depth, 'overlapping places')
      end
    end
    if place.windows ~= nil then check(type(place.windows) == 'boolean', 'invalid windows') end
    local function build_node(field)
      local name = place[field]
      if name == nil then return nil end
      check(type(name) == 'string' and build_nodes[name] == true, 'unsupported material')
      return name
    end
    local item = {id=place.id, anchor=p, radius=radius, depth=depth, space=place.space,
      blueprint=place.blueprint, scene=place.scene, furnished=detailed,
      floor=build_node('floor'), wall=build_node('wall'), ceiling=build_node('ceiling'),
      apron=build_node('apron'), windows=place.windows == true}
    places[place.id] = item; ordered[#ordered+1] = item
  end
  table.sort(ordered, function(a,b) return a.id < b.id end)
  for _, place in ipairs(ordered) do
    local p, r = place.anchor, place.radius
    if place.blueprint then
      sitting_room(p,node)
    elseif place.scene then
      scene_room(p,place.scene,node)
    else
      local floor_name = place.floor or (place.space == 'indoor' and 'default:wood' or 'default:dirt_with_grass')
      local wall_name = place.wall or 'default:wood'
      local ceiling_name = place.ceiling or 'default:wood'
      local base = p.y - 1
      for x = p.x-r, p.x+r do
        for z = p.z-r, p.z+r do
          node(point(x,base,z), floor_name)
          for relative_y = 1, 3 do
            local wall = place.space == 'indoor' and (math.abs(x-p.x)==r or math.abs(z-p.z)==r)
            -- East doorway, feet and head. A lintel stays at y=3. Other walls stay shut.
            local door = wall and x == p.x + r and z == p.z and relative_y <= 2
            local corner = math.abs(x-p.x)==r and math.abs(z-p.z)==r
            local window = place.windows and wall and not door and not corner and relative_y == 2
            local name = nil
            if wall and not door then name = window and 'default:glass' or wall_name end
            node(point(x,base+relative_y,z), name)
          end
          if place.space == 'indoor' then node(point(x,base+4,z), ceiling_name) end
        end
      end
    end
  end
  local connections, seen, path_cells = {}, {}, {}
  for _, c in ipairs(view.semantic_connections) do
    check(type(c) == 'table' and places[c.from] and places[c.to] and c.from ~= c.to,
      'invalid connection')
    local a, b = c.from, c.to
    if b < a then a,b = b,a end
    check(not seen[a .. ':' .. b], 'duplicate connection')
    seen[a .. ':' .. b] = true; connections[#connections+1] = {from=a, to=b}
  end
  table.sort(connections, function(a,b) return a.from .. ':' .. a.to < b.from .. ':' .. b.to end)
  for _, c in ipairs(connections) do
    local a, b = places[c.from], places[c.to]
    if a.anchor.y ~= b.anchor.y then
      check(a.space == 'indoor' and b.space == 'indoor'
        and math.abs(a.anchor.y - b.anchor.y) == 8
        and a.anchor.x == b.anchor.x and a.anchor.z == b.anchor.z,
        'invalid vertical connection')
      local lower_y = math.min(a.anchor.y, b.anchor.y)
      local ladder_x, ladder_z = a.anchor.x - 2, a.anchor.z + 2
      for y = lower_y, math.max(a.anchor.y, b.anchor.y) - 1 do
        local ladder = point(ladder_x, y, ladder_z)
        local support = point(ladder_x - 1, y, ladder_z)
        node(support, 'default:cobble')
        -- wallmounted dir points from the ladder node toward its support (-X).
        node(ladder, 'default:ladder_wood', 3)
        vertical_cells[key(ladder)] = true
        vertical_cells[key(support)] = true
      end
      if vertical_version >= 2 then
        for y = lower_y, math.max(a.anchor.y, b.anchor.y) + 1 do
          for x = ladder_x, ladder_x + 1 do
            for z = ladder_z - 1, ladder_z do
              local cell = point(x,y,z)
              if x ~= ladder_x or z ~= ladder_z or y >= math.max(a.anchor.y,b.anchor.y) then
                node(cell, nil)
              end
              vertical_cells[key(cell)] = true
            end
          end
        end
      end
      if vertical_version >= 3 then
        for y=lower_y,math.max(a.anchor.y,b.anchor.y) do
          for z=ladder_z-1,ladder_z do
            node(point(ladder_x-1,y,z), 'default:cobble')
            node(point(ladder_x+2,y,z), 'default:cobble')
            node(point(ladder_x,y,z), 'default:ladder_wood', 3)
            node(point(ladder_x+1,y,z), 'default:ladder_wood', 2)
            for x=ladder_x-1,ladder_x+2 do vertical_cells[key(point(x,y,z))] = true end
          end
        end
      end
    end
  end
  local function route(a, b, from, to, stand_y)
    local function route_key(x, z) return x .. ',' .. z end
    local function blocked(x, z)
      for y=stand_y-1,stand_y+1 do
        if vertical_cells[key(point(x,y,z))] then return true end
      end
      for _, other in ipairs(ordered) do
        if other.anchor.y == stand_y and math.abs(x-other.anchor.x) <= other.radius
          and math.abs(z-other.anchor.z) <= other.depth then
          if other.id ~= from and other.id ~= to then return true end
          if other.furnished then
            for y=stand_y,stand_y+1 do
              local cell = nodes[key(point(x,y,z))]
              if cell and cell.value ~= false then return true end
            end
          end
        end
      end
      return false
    end
    local queue = {{x=a.x, z=a.z, parent=0}}
    local seen = {[route_key(a.x, a.z)] = 1}
    local directions = {{1,0}, {0,1}, {-1,0}, {0,-1}}
    local finish, cursor = nil, 1
    while cursor <= #queue and not finish do
      local current = queue[cursor]
      if current.x == b.x and current.z == b.z then
        finish = cursor
        break
      end
      for _, direction in ipairs(directions) do
        local x, z = current.x + direction[1], current.z + direction[2]
        local key = route_key(x, z)
        if x >= -64 and x <= 64 and z >= -64 and z <= 64
          and not seen[key] and not blocked(x, z) then
          queue[#queue+1] = {x=x, z=z, parent=cursor}
          seen[key] = #queue
        end
      end
      cursor = cursor + 1
    end
    check(finish ~= nil, 'no clear connection route')
    local reversed = {}
    while finish > 0 do
      local item = queue[finish]
      reversed[#reversed+1] = {x=item.x, z=item.z}
      finish = item.parent
    end
    local result = {}
    for i = #reversed, 1, -1 do result[#result+1] = reversed[i] end
    return result
  end
  for _, c in ipairs(connections) do
    local a,b = places[c.from].anchor, places[c.to].anchor
    if a.y == b.y then
    local function path(x,z)
      path_cells[key(point(x,a.y,z))] = true
      for _,place in ipairs(ordered) do
        if place.anchor.y == a.y and place.furnished and math.abs(x-place.anchor.x)<=place.radius
          and math.abs(z-place.anchor.z)<=place.depth then return end
      end
      node(point(x,a.y-1,z), 'default:stone')
      for y=a.y,a.y+2 do node(point(x,y,z), nil) end
    end
    local route_cells = route(a, b, c.from, c.to, a.y)
    local function inside(place, p)
      return place.anchor.y == a.y and math.abs(p.x-place.anchor.x) <= place.radius
        and math.abs(p.z-place.anchor.z) <= place.depth
    end
    for i, p in ipairs(route_cells) do
      -- A ground path must also cross the connected rooms' walls. Open only
      -- the boundary cells where this route enters or leaves each interior.
      for _, place in ipairs(ordered) do
        local on_boundary = math.abs(p.x-place.anchor.x) == place.radius
          or math.abs(p.z-place.anchor.z) == place.depth
        if place.space == 'indoor' and inside(place,p) and on_boundary then
          local previous, following = route_cells[i-1], route_cells[i+1]
          local crosses = (previous and not inside(place,previous))
            or (following and not inside(place,following))
          if crosses then
            node(point(p.x,a.y,p.z), nil)
            node(point(p.x,a.y+1,p.z), nil)
          end
        end
      end
      path(p.x,p.z)
    end
    end
  end
  -- A one-node ring outside an indoor place. Skip cells already claimed by a
  -- room or a connection so the doorway and the stone route stay as planned.
  for _, place in ipairs(ordered) do
    if place.apron and place.space == 'indoor' then
      local p, r = place.anchor, place.radius
      for x = p.x-r-1, p.x+r+1 do
        for z = p.z-r-1, p.z+r+1 do
          if (math.abs(x-p.x) == r+1 or math.abs(z-p.z) == r+1)
            and x >= -64 and x <= 64 and z >= -64 and z <= 64 then
            local at = point(x, place.anchor.y - 1, z)
            if nodes[key(at)] == nil then node(at, place.apron) end
          end
        end
      end
    end
  end
  local function interior(place_id, p)
    local place = places[place_id]
    check(place and p.y == place.anchor.y and math.abs(p.x-place.anchor.x) <= (place.furnished and 4 or 2)
      and math.abs(p.z-place.anchor.z) <= (place.furnished and 3 or 2), 'start/object outside place interior')
    if place.furnished then
      for y=p.y,p.y+1 do
        check(nodes[key(point(p.x,y,p.z))].value == false, 'start/object blocked by furnishing')
      end
    end
    check(not vertical_cells[key(p)] and not vertical_cells[key(point(p.x,p.y+1,p.z))],
      'start/object blocks vertical connection')
    check(not occupied[key(p)], 'start/object collision'); occupied[key(p)] = true
  end
  local actor_ids, ordinals = {}, {}
  for _, actor in ipairs(view.actors) do
    check(type(actor) == 'table' and id(actor.actor_id) and not actor_ids[actor.actor_id]
      and integer(actor.ordinal,0,#view.actors-1) and not ordinals[actor.ordinal], 'invalid actor identity')
    actor_ids[actor.actor_id], ordinals[actor.ordinal] = true,true
    local p = position(actor.position); interior(actor.place_id, p)
    actors[#actors+1] = {kind='actor', key='actor:' .. actor.actor_id,
      value={actor_id=actor.actor_id, ordinal=actor.ordinal, place_id=actor.place_id, position=p}}
  end
  local object_ids = {}
  for _, object in ipairs(objects) do
    check(type(object) == 'table' and id(object.id) and not object_ids[object.id]
      and interactive[object.node], 'invalid interactive object')
    if object.render_by_state ~= nil then
      check(type(object.render_by_state) == 'table', 'invalid object render states')
      local render_count, has_initial_render = 0, false
      for state, node_name in pairs(object.render_by_state) do
        check(id(state) and interactive[node_name], 'unsupported object render state')
        if node_name == object.node then has_initial_render = true end
        render_count = render_count + 1
      end
      check(render_count <= 4 and has_initial_render, 'too many or missing initial object render states')
    end
    object_ids[object.id] = true
    local p = position(object.position); interior(object.place_id, p)
    check(not path_cells[key(p)], 'object blocks connection')
    -- Object ids are retained in the operation for the adapter's interaction map.
    node(p, object.node)
    nodes[key(p)].object_id = object.id
    nodes[key(p)].place_id = object.place_id
    nodes[key(p)].render_by_state = copy(object.render_by_state)
    -- The adapter must verify the durable interaction binding as well as the
    -- node. Seeing a chest alone cannot prove this origin object was installed.
    nodes[key(p)].value.object_id = object.id
    nodes[key(p)].value.place_id = object.place_id
  end
  local operations = {}
  for _, op in pairs(nodes) do operations[#operations+1] = op end
  table.sort(operations, function(a,b) return a.key < b.key end)
  table.sort(actors, function(a,b) return a.key < b.key end)
  for _, op in ipairs(actors) do operations[#operations+1] = op end
  return {world_id=manifest.world_id, origin_event_id=manifest.origin_event_id,
    operations=operations}
end

-- The base game can naturally turn a grass surface into plain dirt when its
-- light conditions change (for example, after a resource or structure is
-- placed above it). This is a valid world evolution, not a changed origin
-- structure. Keep all other projected nodes exact during product recovery.
function M.node_matches_origin(operation, actual_name, actual_param2)
  if type(operation) ~= 'table' or operation.kind ~= 'node'
    or type(actual_name) ~= 'string' then return false end
  local expected = operation.value and operation.value.name or 'air'
  local expected_param2 = operation.value and operation.value.param2 or 0
  return (actual_param2 == expected_param2 or (actual_param2 == nil and expected_param2 == 0))
    and (actual_name == expected
      or (expected == 'default:dirt_with_grass' and actual_name == 'default:dirt'))
end

function M.apply(manifest, adapter)
  local plan = M.plan(manifest) -- Recompile rather than trust a mutable caller plan.
  check(type(adapter) == 'table' and type(adapter.binding) == 'function'
    and type(adapter.read) == 'function' and type(adapter.write) == 'function', 'invalid adapter')
  local function bound()
    local binding = adapter.binding()
    check(type(binding) == 'table' and binding.world_id == plan.world_id
      and binding.origin_event_id == plan.origin_event_id, 'adapter binding mismatch')
  end
  local function read(op)
    local actual = adapter.read(copy(op))
    check(actual ~= nil, 'unknown state at ' .. op.key)
    check(actual == false or equal(actual, op.value), 'conflicting state at ' .. op.key)
    return actual
  end
  bound()
  -- Preflight the entire area (including air clearance) before the first write.
  for _, op in ipairs(plan.operations) do read(op) end
  local writes = 0
  for _, op in ipairs(plan.operations) do
    bound()
    if read(op) == false and op.value ~= false then
      adapter.write(copy(op))
      check(equal(adapter.read(copy(op)), op.value), 'write verification failed at ' .. op.key)
      writes = writes + 1
    end
  end
  bound()
  for _, op in ipairs(plan.operations) do
    check(equal(adapter.read(copy(op)), op.value), 'final verification failed at ' .. op.key)
  end
  return {writes=writes, world_id=plan.world_id, origin_event_id=plan.origin_event_id}
end

return M
