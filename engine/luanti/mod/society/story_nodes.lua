-- Small, non-inventory story props. The server callback owns every action;
-- client node metadata is only an object pointer used for consistency checks.
local M = {}

local function base(description, texture, box, callback)
  return {
    description = description,
    drawtype = "nodebox",
    tiles = {texture, texture, texture, texture, texture, texture},
    paramtype = "light",
    paramtype2 = "facedir",
    sunlight_propagates = true,
    walkable = false,
    pointable = true,
    diggable = false,
    buildable_to = false,
    node_box = {type = "fixed", fixed = box},
    selection_box = {type = "fixed", fixed = box},
    groups = {not_in_creative_inventory = 1},
    on_rightclick = function(pos, node, clicker)
      if callback then callback(pos, node, clicker) end
    end,
  }
end

function M.register(engine, callback)
  assert(type(engine) == "table" and type(engine.register_node) == "function",
    "story nodes require engine.register_node")
  assert(type(callback) == "function", "story interaction callback required")
  engine.register_node("society:story_notice", base("Red-Headed League notice",
    "society_interior_papers.png", {-0.38, -0.45, -0.06, 0.38, 0.45, 0.06}, callback))
  engine.register_node("society:story_surface", base("Cellar work surface",
    "default_dirt.png", {-0.48, -0.45, -0.48, 0.48, -0.30, 0.48}, callback))
  engine.register_node("society:story_surface_disturbed", base("Disturbed cellar work surface",
    "default_gravel.png", {-0.48, -0.45, -0.48, 0.48, -0.25, 0.48}, callback))
end

return M
