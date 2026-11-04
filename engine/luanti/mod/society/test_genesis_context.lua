-- lua5.1 engine/luanti/mod/society/test_genesis_context.lua
local context = dofile('engine/luanti/mod/society/genesis_context.lua')
local manifest = {
  origin_event_id = 'genesis:confirmed-1',
  public = {title = 'River Settlement', description = 'Residents share the valley.'},
  actors = {{actor_id = 'alice', goal = 'PRIVATE_GOAL', memory_seeds = {'PRIVATE_SEED'}}},
}
local fact = context.public_world_fact(manifest, 'alice')
assert(fact.id == 'genesis:world:genesis:confirmed-1')
assert(fact.text == 'World: River Settlement. Residents share the valley.')
assert(fact.scope == 'public' and #fact.audience == 1 and fact.audience[1] == 'alice')
assert(fact.source.kind == 'genesis.public' and fact.source.id == manifest.origin_event_id)
assert(not fact.text:find('PRIVATE_GOAL', 1, true))
assert(not fact.text:find('PRIVATE_SEED', 1, true))

-- Old confirmed worlds remain loadable and retain their public title context.
manifest.public.description = nil
local old_fact = context.public_world_fact(manifest, 'bob')
assert(old_fact.text == 'World: River Settlement')
assert(old_fact.audience[1] == 'bob')
manifest.public.description = 'Residents share the valley.'
manifest.public.places = {
  {id = 'bank', name = '岸', description = '河岸', space = 'outdoor', anchor = {x = 0, y = 1, z = 0}},
  {id = 'room', name = '屋', description = '室内', space = 'indoor', anchor = {x = 8, y = 1, z = 0}},
}
manifest.actors[1].goal = 'PRIVATE_GOAL'
local places = context.public_places(manifest)
assert(places[1].id == 'bank' and places[1].point.x == 0 and places[1].point.y == 1)
assert(places[2].id == 'room' and places[2].space == 'indoor' and places[2].point.x == 8)
assert(places[1].description == nil and places[1].goal == nil)
local place_facts = context.public_place_facts(manifest, 'alice')
assert(#place_facts == 2)
assert(place_facts[1].id == 'genesis:place:genesis:confirmed-1:bank')
assert(place_facts[1].text:find('x=0, y=1, z=0', 1, true))
assert(place_facts[1].text:find('河岸', 1, true))
assert(place_facts[2].text:find('x=8, y=1, z=0', 1, true))
for _, fact in ipairs(place_facts) do
  assert(fact.scope == 'public' and fact.audience[1] == 'alice')
  assert(not fact.text:find('PRIVATE_GOAL', 1, true))
  assert(not fact.text:find('PRIVATE_SEED', 1, true))
end
print('ok - public Genesis context is shared as a fact and remains actor-scoped')
