-- Installed only in a disposable acceptance world. Drives a connected player
-- through the production interaction callbacks; never chooses an NPC action.
local world = minetest.get_worldpath()
local f = assert(io.open(world .. "/rhl-playable-probe", "r"))
assert(f:read("*a") == "automated-player-v1\n"); f:close()
local f = assert(io.open(world .. "/private/wispiva-origin.json", "r"))
local manifest = minetest.parse_json(f:read("*a")); f:close()
local forms, replies, stage, tick = {}, {}, 0, 0
local player_name = "rhl_acceptance"
local show = minetest.show_formspec
minetest.show_formspec = function(name, form, body)
  if name == player_name then forms.current = form; forms.body = body end
  return show(name, form, body)
end
local chat = minetest.chat_send_player
minetest.chat_send_player = function(name, text)
  if name == player_name and text:find("角色私下回应", 1, true) then
    replies[#replies+1] = minetest.sha1(text)
  end
  return chat(name, text)
end
local function submit(player, fields)
  assert(forms.current and forms.current:match("^wispiva:story:"), "missing production form")
  for _, callback in ipairs(minetest.registered_on_player_receive_fields) do
    if callback(player, forms.current, fields) then break end
  end
end
local function actor()
  for _, object in ipairs(minetest.get_objects_inside_radius({x=0,y=0,z=0}, 160)) do
    local e = object:get_luaentity()
    if e and e._actor_id == "holmes" then return e end
  end
end
local function address(player, text)
  local e = actor()
  if not e then return false end
  assert(e.object:get_properties().pointable == true, "NPC cannot be selected for right-click interaction")
  player:set_pos(vector.add(e.object:get_pos(), {x=1,y=0,z=0}))
  e:on_rightclick(player)
  submit(player, {send=true, message=text})
  return true
end
minetest.register_globalstep(function(dt)
  tick = tick + dt
  if tick < 0.5 then return end
  tick = 0
  local player = minetest.get_player_by_name(player_name)
  if not player then return end
  if stage == 0 then
    local object
    for _, value in ipairs(manifest.public.objects) do
      if value.id == "dissolution_notice" then object = value end
    end
    assert(object, "notice missing")
    local node = minetest.get_node(object.position)
    if node.name == "ignore" then return end
    player:set_pos(vector.add(object.position, {x=1,y=0,z=0}))
    minetest.registered_nodes[node.name].on_rightclick(object.position, node, player)
    assert(forms.body:find("#L", 1, true), "object form has no source citation")
    submit(player, {record=true})
    minetest.registered_chatcommands.journal.func(player_name)
    assert(forms.body:find("#L", 1, true), "journal has no source citation")
    stage = 1
    minetest.log("action", "RHL_PLAYABLE investigation-and-journal=true")
  elseif stage == 1 then
    if address(player, "Mr Holmes, I have read the League dissolution notice. I have not visited the pawnshop cellar. What can we actually infer from the notice, and what should I check next?") then
      stage = 2
      minetest.log("action", "RHL_PLAYABLE first-player-message=true")
    end
  elseif stage == 2 and #replies >= 1 then
    if address(player, "An update to my earlier question: I still have not entered the cellar. I heard someone claim there is a tunnel, but I have no direct evidence. Does that change your advice? Please distinguish what I reported from what you have observed.") then
      stage = 3
      minetest.log("action", "RHL_PLAYABLE second-player-message=true")
    end
  elseif stage == 3 and #replies >= 2 then
    assert(replies[1] ~= replies[2], "responses did not change")
    minetest.registered_chatcommands.journal.func(player_name)
    assert(forms.body:find("私下回应", 1, true), "reply absent from player journal")
    stage = 4
    minetest.log("action", "RHL_PLAYABLE two-distinct-replies-and-journal=true")
  end
  if stage == 4 then
    for _, object in ipairs(manifest.public.objects) do
      if object.id == "cellar_workface" then
        local node = minetest.get_node(object.position)
        if node.name == "society:story_surface_disturbed" then
          minetest.log("action", "RHL_PLAYABLE complete=true changed-node=true")
          stage = 5
        end
      end
    end
  end
end)

local ladder_command, ladder_tick = nil, 0
minetest.register_globalstep(function(dt)
  ladder_tick = ladder_tick + dt
  if ladder_tick < 0.1 then return end
  ladder_tick = 0
  local player = minetest.get_player_by_name(player_name)
  if not player then return end
  local request = io.open(world .. "/rhl-ladder-request", "r")
  if request then
    local command = request:read("*a"); request:close()
    if command ~= ladder_command and (command == "top" or command == "bottom") then
      minetest.close_formspec(player_name, forms.current or "")
      local place
      for _, p in ipairs(manifest.public.places) do
        if p.id == (command == "top" and "pawnshop" or "cellar") then place=p end
      end
      assert(place, "ladder endpoint missing")
      player:set_pos({x=place.anchor.x-1.5, y=place.anchor.y-0.5, z=place.anchor.z+1.5})
      player:set_velocity({x=0,y=0,z=0})
      ladder_command = command
    end
  end
  if ladder_command then
    local pos, controls = player:get_pos(), player:get_player_control()
    minetest.safe_file_write(world .. "/private/ladder-status.json", minetest.write_json({
      command=ladder_command, y=pos.y, jump=controls.jump, sneak=controls.sneak}))
  end
end)
