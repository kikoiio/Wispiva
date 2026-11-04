-- TEST-ONLY worldmod, installed only into capture_scene.py's fresh world.
-- The normal product blueprint creates ALL room geometry and furnishings.
-- This module only controls cameras/daylight and hides people/UI to match the
-- generated empty-room reference. It is not evidence of model/actor behavior.
local world = minetest.get_worldpath()
local guard = assert(io.open(world .. "/rhl-capture-fixture", "rb"), "capture fixture marker missing")
local fixture = guard:read(64); guard:close()
assert(fixture == "wispiva-interior-reference-v1\n", "capture fixture marker invalid")

local player_name = "rhl_capture"
local cameras = {
    reference = {
        position = {x=3.7, y=1, z=-3.7},
        target = {x=0, y=2.2, z=3.6},
        fov = 80,
    },
    reverse = {
        position = {x=-4, y=1.2, z=3.3},
        target = {x=0, y=2.1, z=-2.6},
        fov = 85,
    },
}
local hidden = { ["society:agent"]=true, ["society:view_landmark"]=true, ["society:view_guide"]=true }
local joined, current, tick = false, nil, 0

minetest.settings:set("time_speed", "0")
minetest.set_timeofday(0.5)

local function hide_overlay(player)
    player:hud_set_flags({hotbar=false, healthbar=false, crosshair=false, wielditem=false,
        breathbar=false, minimap=false, minimap_radar=false, basic_debug=false, chat=false})
    -- society's nearest-place text is a custom HUD element, separate from the
    -- built-in flags. Removing it here is confined to this disposable viewer.
    for id in pairs(player:hud_get_all()) do player:hud_remove(id) end
end

local function hide_people()
    for _, object in ipairs(minetest.get_objects_inside_radius({x=0,y=2,z=0}, 96)) do
        local entity = object:get_luaentity()
        if entity and hidden[entity.name] then
            object:set_properties({is_visible=false, pointable=false,
                nametag="", nametag_color="#00000000"})
        end
    end
end

local function camera(id)
    local player = minetest.get_player_by_name(player_name)
    assert(player, "capture client disconnected")
    local view = assert(cameras[id], "unknown capture camera")
    current = id
    player:set_physics_override({speed=0, jump=0, gravity=0})
    player:set_properties({eye_height=1.6, is_visible=false})
    player:set_eye_offset({x=0,y=0,z=0})
    player:set_pos(view.position)
    local eye = {x=view.position.x, y=view.position.y+1.6, z=view.position.z}
    local dx, dy, dz = view.target.x-eye.x, view.target.y-eye.y, view.target.z-eye.z
    player:set_look_horizontal(math.atan2(-dx, dz))
    player:set_look_vertical(-math.atan2(dy, math.sqrt(dx*dx+dz*dz)))
    player:set_fov(view.fov, false, 0)
    player:override_day_night_ratio(1)
    player:set_sky({type="regular", clouds=false})
    player:set_clouds({density=0, speed={x=0,z=0}})
    minetest.set_timeofday(0.5)
    hide_overlay(player)
    hide_people()
    -- Allow map/mesh transfers and fixed-camera rendering to settle. Python
    -- polls this marker while checking that the real client/server stay alive.
    minetest.after(6, function()
        assert(minetest.get_player_by_name(player_name), "capture client disconnected before ready")
        assert(current == id, "capture camera changed before ready")
        minetest.log("action", "RHL_CAPTURE camera-ready id=" .. id .. " player=" .. player_name)
    end)
end

minetest.register_on_joinplayer(function(player)
    assert(player:get_player_name() == player_name and not joined, "unexpected capture client")
    joined = true
    minetest.log("action", "RHL_CAPTURE client-connected player=" .. player_name)
    -- Run after society/player_api's join setup and their immediate callbacks.
    minetest.after(0.2, function() camera("reference") end)
end)

minetest.register_globalstep(function(dtime)
    tick = tick + dtime
    if tick < 0.25 then return end
    tick = 0
    hide_people()
    local player = minetest.get_player_by_name(player_name)
    if not player then return end
    hide_overlay(player)
    if current ~= "reference" then return end
    -- Python acknowledges a completed reference PNG before moving the camera;
    -- the first view remains stable regardless of screenshot command latency.
    local request = io.open(world .. "/rhl-capture-next", "rb")
    if request then
        local value = request:read(32); request:close()
        assert(value == "reverse\n", "invalid capture camera request")
        camera("reverse")
    end
end)
