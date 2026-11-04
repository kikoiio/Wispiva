-- Offline geometry and navigation checks; actual appearance needs Luanti capture.
local projection = dofile('engine/luanti/mod/society/world_projection.lua')
local navigation = dofile('cognition/navigation.lua')
local assets = dofile('engine/luanti/mod/society/interior_nodes.lua')
local function fixture()
  return {format='wispiva-world-manifest',version=1,
    world_id='12345678-1234-4234-8234-123456789abc',origin_event_id='origin-1',
    public={places={{id='room',space='indoor',anchor={x=0,y=1,z=0},
      blueprint='victorian_sitting_room_v1'}},semantic_connections={},actors={}}}
end
local function key(p) return p.x .. ',' .. p.y .. ',' .. p.z end
local function map(doc)
  local cells = {}
  for _,op in ipairs(projection.plan(doc).operations) do
    if op.kind=='node' then cells[key(op.position)]=op.value end
  end
  return cells
end
local doc = fixture()
local cells = map(doc)
local definitions = assets.definitions()
for _,value in pairs(cells) do
  if value then
    assert(definitions[value.name], 'missing registered asset: ' .. value.name)
    assert(value.param2>=0 and value.param2<=3)
  end
end
assert(cells['0,5,0'].name=='society:plaster')
assert(cells['-5,3,-1'].name=='society:sash_window')
assert(cells['0,1,3'].name=='society:hearth_fire')
assert(cells['-2,1,0'].param2==3 and cells['2,1,0'].param2==1)
assert(cells['0,1,0']==false and cells['5,1,-2']==false and cells['5,2,-2']==false)
assert(cells['5,1,0'].name=='society:panelling')
assert(not projection.node_matches_origin({kind='node',value=cells['-2,1,0']},'society:armchair',0))
assert(projection.node_matches_origin({kind='node',value=cells['-2,1,0']},'society:armchair',3))

local engine = {registered_nodes=definitions}
function engine.get_node_or_nil(p)
  local value=cells[key(p)]
  return {name=value and value.name or (p.y==0 and 'society:parquet' or 'air')}
end
local function reach(start,target)
  local current=start
  for _=1,80 do
    local next_pos,reason=navigation.step(engine,current,target,{bound=16,max_scan=1089,step=2})
    if not next_pos then assert(reason=='arrived',reason); return end
    current=next_pos
  end
  error('navigation did not finish')
end
-- All compiler spawn slots can reach both the public anchor and the real door.
local slots={}
for _,z in ipairs({-2,1}) do for x=-3,3 do slots[#slots+1]={x=x,y=1,z=z} end end
for x=-2,2 do slots[#slots+1]={x=x,y=1,z=2} end
slots[#slots+1]={x=0,y=1,z=0}
assert(#slots==20)
for _,start in ipairs(slots) do
  reach(start,{x=0,y=1,z=0})
  reach(start,{x=6,y=1,z=-2})
end
local blocked=fixture()
blocked.public.actors={{actor_id='alice',ordinal=0,place_id='room',position={x=-2,y=1,z=0}}}
local ok,err=pcall(projection.plan,blocked)
assert(not ok and tostring(err):find('blocked by furnishing',1,true))

-- Semantic connections route through the door, retaining the rug and furniture.
doc.public.places[2]={id='yard',space='outdoor',anchor={x=16,y=1,z=0}}
doc.public.semantic_connections={{from='room',to='yard'}}
local linked=map(doc)
assert(linked['5,1,-2']==false and linked['5,1,0'].name=='society:panelling')
assert(linked['0,0,0'].name=='society:rug_center')
assert(linked['-2,1,0'].name=='society:armchair' and linked['0,1,-1'].name=='society:coffee_table_center')

-- The blueprint follows an arbitrary room id and translated anchor.
doc=fixture(); doc.public.places[1].id='unrelated-library'
doc.public.places[1].anchor={x=8,y=1,z=-8}
local translated=map(doc)
assert(translated['8,1,-5'].name=='society:hearth_fire')
assert(translated['13,1,-10']==false)
print('interior blueprint: registered assets, orientation, 20 safe starts, door paths and translated reuse passed')
