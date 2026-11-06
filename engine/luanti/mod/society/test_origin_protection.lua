local protection = dofile("engine/luanti/mod/society/origin_protection.lua")
local called, warning = false, false
local engine = {
  is_protected=function(p, name) called=true; return p.x == 99 and name == "alice" end,
  register_on_protection_violation=function(callback) warning=callback end,
  chat_send_player=function(name, text) assert(name == "alice" and text:find("右键")) end,
}
protection.install(engine, {
  {kind="node",position={x=1,y=0,z=2},value={name="society:rug_center"}},
  {kind="node",position={x=1,y=1,z=2},value=false},
  {kind="actor",position={x=3,y=1,z=2}},
  {kind="node",position={x=4,y=0,z=2},value={name="default:dirt"},terrain=true},
})
assert(engine.is_protected({x=1,y=0,z=2},"alice"), "scene floor can be dug")
assert(engine.is_protected({x=1,y=1,z=2},"alice"), "scene passage can be blocked")
assert(not called)
assert(not engine.is_protected({x=3,y=1,z=2},"alice"), "actor position should not claim terrain")
assert(not engine.is_protected({x=4,y=0,z=2},"alice"), "terrain must remain editable")
assert(engine.is_protected({x=99,y=1,z=2},"alice"), "existing protection was bypassed")
warning({x=1,y=0,z=2},"alice")
print("origin protection: scene structure, passages and existing protection passed")
