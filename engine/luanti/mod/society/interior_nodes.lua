-- Original reusable interior material/furniture kit. Pure definitions; no engine at load time.
-- Coordinates are metres relative to integer node centres. Furniture front=-Z,
-- rear=+Z; facedir rotates geometry, selection/collision boxes and textures.
-- Floor cubes (including rugs) live at y=0, with their top at world y=0.5.
-- Furniture lives at y=1, feet at local -0.5. Desk top is +0.5; standalone
-- accessories at y=2 start at -0.49 (1cm clearance). Coffee-table top is +0.05
-- (0.55m above floor); its combined paper/tea variants start accessories at
-- +0.06, translating standalone accessory boxes by +0.55 in the table's cell.
-- Armchair back reaches +0.78 (1.28m above the floor); leave the cell above free.
-- No seats, inventories, fire damage, timers, or other interactions are implied.
local M = {}

local function texture(name)
  return 'society_interior_' .. name .. '.png'
end

local function copy(value)
  if type(value) ~= 'table' then return value end
  local result = {}
  for key, item in pairs(value) do result[key] = copy(item) end
  return result
end

-- Luanti order: +Y, -Y, +X, -X, +Z (back), -Z (front).
local function faces(top, bottom, sides, back, front)
  return {texture(top), texture(bottom), texture(sides), texture(sides),
    texture(back or sides), texture(front or sides)}
end

local function cube(description, tiles, facedir)
  return {
    description = description,
    drawtype = 'normal',
    tiles = tiles,
    paramtype2 = facedir and 'facedir' or nil,
    is_ground_content = false,
    walkable = true,
    node_box = {type = 'regular'},
    selection_box = {type = 'regular'},
    collision_box = {type = 'regular'},
    groups = {choppy = 2, oddly_breakable_by_hand = 2},
  }
end

local function shaped(description, tiles, boxes, options)
  local definition = {
    description = description,
    drawtype = 'nodebox',
    paramtype = 'light',
    paramtype2 = 'facedir',
    sunlight_propagates = true,
    is_ground_content = false,
    use_texture_alpha = 'opaque',
    tiles = tiles,
    walkable = true,
    node_box = {type = 'fixed', fixed = copy(boxes)},
    selection_box = {type = 'fixed', fixed = copy(boxes)},
    collision_box = {type = 'fixed', fixed = copy(boxes)},
    groups = {choppy = 2, oddly_breakable_by_hand = 2},
  }
  for key, value in pairs(options or {}) do definition[key] = copy(value) end
  return definition
end

local function settee_boxes(part)
  -- Three adjacent local X cells. Side arms appear only on the outer ends;
  -- seat, apron and back meet exactly at +/-0.5 without cracks or overlaps.
  local left = part == 'left' and -0.32 or -0.5
  local right = part == 'right' and 0.32 or 0.5
  local boxes = {
    {-0.5, -0.29, -0.40, 0.5, -0.13, 0.40}, -- walnut apron
    {left, -0.13, -0.42, right, 0.055, 0.28}, -- separate cushion
    {-0.5, -0.10, 0.27, 0.5, 0.42, 0.44}, -- upholstered back
    {-0.5, 0.42, 0.29, 0.5, 0.49, 0.43}, -- top rail
  }
  if part ~= 'middle' then
    local x = part == 'left' and -0.43 or 0.43
    boxes[#boxes + 1] = {x - 0.055, -0.5, -0.34, x + 0.055, -0.28, -0.23}
    boxes[#boxes + 1] = {x - 0.055, -0.5, 0.25, x + 0.055, -0.28, 0.36}
    boxes[#boxes + 1] = {x - 0.07, -0.13, -0.40, x + 0.07, 0.20, 0.37}
    boxes[#boxes + 1] = {x - 0.07, 0.20, -0.42, x + 0.07, 0.27, 0.38}
  end
  return boxes
end

local function bookcase_boxes()
  local boxes = {
    {-0.5, -0.5, -0.25, -0.43, 0.5, 0.5},
    {0.43, -0.5, -0.25, 0.5, 0.5, 0.5},
    {-0.43, -0.5, 0.38, 0.43, 0.5, 0.5}, -- real recessed back
    {-0.5, -0.5, -0.27, 0.5, -0.43, 0.5},
    {-0.5, 0.44, -0.27, 0.5, 0.5, 0.5},
  }
  -- Same pixel positions/heights as BOOKS in the texture generator. Individual
  -- spines have different heights and project 1cm either side of the shelf line.
  local books = {{5,10,8}, {11,16,6}, {17,23,9}, {24,29,7}, {30,35,10},
    {36,42,6}, {43,48,8}, {49,54,5}, {55,58,11}}
  for index, book in ipairs(books) do
    boxes[#boxes + 1] = {book[1]/64 - 0.5, -0.43, -0.19 - (index % 2)*0.01,
      (book[2]+1)/64 - 0.5, 0.5 - book[3]/64, 0.30}
  end
  return boxes
end

function M.definitions()
  -- Construct every nested table afresh: callers/tests may safely mutate their
  -- copies, and engine.register_node cannot contaminate a subsequent call.
  local definitions = {}
  local function add(name, definition) definitions['society:' .. name] = definition end

  for _, material in ipairs({
    {'parquet', 'Basket-weave oak parquet'},
    {'wallpaper', 'Moss-green fleur-de-lis wallpaper'},
    {'panelling', 'Raised walnut wall panelling'},
    {'plaster', 'Warm ivory plaster'},
    {'cornice', 'Ivory dentil cornice'},
    {'walnut', 'Dark polished walnut'},
    {'hearth_stone', 'Soot-dark hearth stone'},
  }) do
    add(material[1], cube(material[2], {texture(material[1])}))
  end
  definitions['society:hearth_stone'].groups = {cracky = 2, oddly_breakable_by_hand = 2}

  -- These are full FLOOR cubes, not rugs occupying the feet/air cell. Border
  -- texel row 0 is local -Z, corner column 0 is local -X; rotate with facedir.
  for _, part in ipairs({'center', 'edge', 'corner'}) do
    add('rug_' .. part, cube('Woven crimson carpet (' .. part .. ')',
      faces('rug_' .. part, 'walnut', 'walnut'), true))
  end

  add('armchair', shaped('Buttoned oxblood leather armchair',
    faces('leather', 'walnut', 'armchair_front', 'armchair_front', 'armchair_front'), {
      {-0.39, -0.5, -0.36, -0.30, -0.22, -0.27}, -- four walnut legs/brass toes
      {0.30, -0.5, -0.36, 0.39, -0.22, -0.27},
      {-0.39, -0.5, 0.27, -0.30, -0.22, 0.36},
      {0.30, -0.5, 0.27, 0.39, -0.22, 0.36},
      {-0.43, -0.27, -0.39, 0.43, -0.12, 0.39}, -- upholstered apron
      {-0.32, -0.12, -0.42, 0.32, 0.065, 0.26}, -- distinct seat cushion
      {-0.43, -0.10, 0.23, 0.43, 0.45, 0.40}, -- stepped/reclined back
      {-0.37, 0.45, 0.27, 0.37, 0.65, 0.43},
      {-0.30, 0.65, 0.30, 0.30, 0.74, 0.43},
      {-0.26, 0.74, 0.31, 0.26, 0.78, 0.42},
      {-0.46, -0.12, -0.39, -0.32, 0.22, 0.32}, -- left arm and roll
      {-0.46, 0.22, -0.42, -0.31, 0.30, 0.33},
      {0.32, -0.12, -0.39, 0.46, 0.22, 0.32},
      {0.31, 0.22, -0.42, 0.46, 0.30, 0.33},
    }))

  for _, part in ipairs({'left', 'middle', 'right'}) do
    add('settee_' .. part, shaped('Ochre damask settee (' .. part .. ')',
      faces('ochre', 'walnut', 'settee_front', 'settee_front', 'settee_front'),
      settee_boxes(part)))
  end

  add('coffee_table', shaped('Inlaid walnut coffee table',
    faces('table_top', 'walnut', 'walnut'), {
      {-0.49, -0.04, -0.48, 0.49, 0.05, 0.48},
      {-0.44, -0.19, -0.40, 0.44, -0.04, -0.34}, -- apron around open under-table
      {-0.44, -0.19, 0.34, 0.44, -0.04, 0.40},
      {-0.44, -0.19, -0.34, -0.38, -0.04, 0.34},
      {0.38, -0.19, -0.34, 0.44, -0.04, 0.34},
      {-0.43, -0.5, -0.39, -0.32, -0.18, -0.28},
      {0.32, -0.5, -0.39, 0.43, -0.18, -0.28},
      {-0.43, -0.5, 0.28, -0.32, -0.18, 0.39},
      {0.32, -0.5, 0.28, 0.43, -0.18, 0.39},
      {-0.36, -0.39, -0.04, 0.36, -0.33, 0.04}, -- low stretcher
    }))
  local center = copy(definitions['society:coffee_table'])
  for _,field in ipairs({'node_box','selection_box','collision_box'}) do
    local boxes = center[field].fixed
    for i=9,6,-1 do table.remove(boxes,i) end
  end
  definitions['society:coffee_table_center'] = center

  add('newspaper', shaped('Folded morning newspaper',
    faces('newspaper', 'papers', 'papers'), {
      {-0.40, -0.49, -0.31, -0.01, -0.465, 0.31},
      {0.01, -0.49, -0.31, 0.40, -0.465, 0.31},
      {-0.01, -0.49, -0.30, 0.01, -0.452, 0.30}, -- raised centre fold
    }, {walkable = false, collision_box = {type = 'fixed', fixed = {}}}))

  add('tea_service', shaped('Blue-and-white porcelain tea service',
    {texture('porcelain')}, {
      {-0.38, -0.49, -0.29, 0.38, -0.46, 0.29}, -- tray and raised rim
      {-0.38, -0.46, -0.29, 0.38, -0.44, -0.27},
      {-0.38, -0.46, 0.27, 0.38, -0.44, 0.29},
      {-0.38, -0.46, -0.27, -0.36, -0.44, 0.27},
      {0.36, -0.46, -0.27, 0.38, -0.44, 0.27},
      {-0.29, -0.46, -0.20, -0.08, -0.445, 0.01}, -- saucer
      {-0.255, -0.445, -0.17, -0.115, -0.425, -0.03}, -- cup bottom
      {-0.255, -0.425, -0.17, -0.235, -0.30, -0.03}, -- four hollow cup walls
      {-0.135, -0.425, -0.17, -0.115, -0.30, -0.03},
      {-0.235, -0.425, -0.17, -0.135, -0.30, -0.15},
      {-0.235, -0.425, -0.05, -0.135, -0.30, -0.03},
      {-0.31, -0.40, -0.12, -0.255, -0.38, -0.08}, -- open handle
      {-0.31, -0.38, -0.12, -0.29, -0.335, -0.08},
      {-0.31, -0.335, -0.12, -0.255, -0.315, -0.08},
      {0.035, -0.46, -0.01, 0.255, -0.23, 0.21}, -- stepped teapot
      {0.06, -0.23, 0.015, 0.23, -0.195, 0.185},
      {0.08, -0.195, 0.035, 0.21, -0.18, 0.165},
      {0.13, -0.18, 0.085, 0.16, -0.145, 0.115},
      {-0.015, -0.36, 0.075, 0.035, -0.30, 0.125}, -- rising spout
      {-0.05, -0.31, 0.075, 0.005, -0.255, 0.125},
      {0.255, -0.38, 0.07, 0.32, -0.355, 0.13}, -- open teapot handle
      {0.30, -0.355, 0.07, 0.32, -0.265, 0.13},
      {0.255, -0.285, 0.07, 0.32, -0.26, 0.13},
    }, {walkable = false, collision_box = {type = 'fixed', fixed = {}}}))

  for _, attachment in ipairs({{'paper', 'newspaper', 'Folded paper'},
      {'tea', 'tea_service', 'Porcelain tea service'}}) do
    local boxes = copy(definitions['society:coffee_table'].node_box.fixed)
    -- Each outer section supplies its two end legs. The centre section has
    -- no extra legs, so the three cells form one table supported at its ends.
    local remove = attachment[1]=='paper' and {9,7} or {8,6}
    for _,i in ipairs(remove) do table.remove(boxes,i) end
    for _, accessory_box in ipairs(definitions['society:' .. attachment[2]].node_box.fixed) do
      local shifted = copy(accessory_box)
      shifted[2] = shifted[2] + 0.55
      shifted[5] = shifted[5] + 0.55
      boxes[#boxes + 1] = shifted
    end
    -- Two 64px squares in a vertical atlas: top projection, vertical projection.
    -- The vertical projection changes material above the table top, keeping
    -- porcelain/paper pale and table legs walnut without a mesh dependency.
    local atlas = texture('coffee_table_' .. attachment[1])
    local top = atlas .. '^[sheet:1x2:0,0'
    local side = atlas .. '^[sheet:1x2:0,1'
    add('coffee_table_' .. attachment[1], shaped(attachment[3] .. ' on walnut coffee table',
      {top, texture('walnut'), side, side, side, side}, boxes))
  end

  add('bookcase', shaped('Walnut bookcase with leatherbound volumes',
    faces('walnut', 'walnut', 'walnut', 'walnut', 'books'), bookcase_boxes()))
  add('bookcase_crown', shaped('Walnut bookcase dentil crown', {texture('walnut')}, {
    {-0.5, -0.5, -0.25, 0.5, -0.29, 0.50},
    {-0.5, -0.29, -0.30, 0.5, -0.23, 0.50},
    {-0.5, -0.23, -0.32, 0.5, -0.12, 0.50},
    {-0.43, -0.42, -0.30, -0.33, -0.29, -0.25},
    {-0.23, -0.42, -0.30, -0.13, -0.29, -0.25},
    {-0.03, -0.42, -0.30, 0.07, -0.29, -0.25},
    {0.17, -0.42, -0.30, 0.27, -0.29, -0.25},
    {0.37, -0.42, -0.30, 0.47, -0.29, -0.25},
  }))

  add('desk', shaped('Walnut writing desk',
    faces('table_top', 'walnut', 'panelling', 'walnut', 'panelling'), {
      {-0.49, 0.40, -0.43, 0.49, 0.50, 0.45},
      {-0.44, 0.20, -0.37, 0.44, 0.40, 0.39}, -- shallow drawer apron
      {-0.42, -0.5, -0.35, -0.32, 0.20, -0.25},
      {-0.42, -0.5, 0.26, -0.32, 0.20, 0.36},
      {0.32, -0.5, -0.35, 0.42, 0.20, -0.25},
      {0.32, -0.5, 0.26, 0.42, 0.20, 0.36},
      {0.20, -0.39, -0.36, 0.43, 0.20, 0.37}, -- side pedestal; knee space open
    }))
  add('desk_chair', shaped('Walnut chair with red leather seat',
    faces('leather', 'walnut', 'walnut'), {
      {-0.30, -0.5, -0.29, -0.23, -0.04, -0.22},
      {0.23, -0.5, -0.29, 0.30, -0.04, -0.22},
      {-0.30, -0.5, 0.22, -0.23, 0.64, 0.29},
      {0.23, -0.5, 0.22, 0.30, 0.64, 0.29},
      {-0.32, -0.04, -0.32, 0.32, 0.075, 0.31},
      {-0.30, 0.57, 0.22, 0.30, 0.66, 0.31},
      {-0.21, 0.17, 0.24, -0.16, 0.57, 0.29},
      {-0.025, 0.17, 0.24, 0.025, 0.57, 0.29},
      {0.16, 0.17, 0.24, 0.21, 0.57, 0.29},
      {-0.25, 0.12, 0.22, 0.25, 0.18, 0.30},
    }))
  add('green_lamp', shaped('Brass lamp with green glass shade',
    faces('lamp_green', 'brass', 'lamp'), {
      {-0.16, -0.49, -0.14, 0.16, -0.455, 0.14},
      {-0.10, -0.455, -0.09, 0.10, -0.42, 0.09},
      {-0.025, -0.42, -0.025, 0.025, -0.10, 0.025},
      {-0.22, -0.12, -0.14, 0.22, -0.06, 0.14},
      {-0.19, -0.06, -0.12, 0.19, 0.04, 0.12},
      {-0.14, 0.04, -0.09, 0.14, 0.11, 0.09},
      {-0.035, 0.11, -0.03, 0.035, 0.14, 0.03},
    }, {light_source = 5}))
  add('papers', shaped('Handwritten correspondence',
    faces('papers', 'papers', 'papers'), {
      {-0.30, -0.49, -0.27, 0.30, -0.48, 0.27},
      {-0.28, -0.48, -0.29, 0.27, -0.468, 0.25},
    }, {walkable = false, collision_box = {type = 'fixed', fixed = {}}}))

  add('sash_window', shaped('Ivory sash window',
    faces('plaster', 'plaster', 'plaster', 'window', 'window'), {
      {-0.5, -0.5, 0.34, -0.4375, 0.5, 0.49},
      {0.4375, -0.5, 0.34, 0.5, 0.5, 0.49},
      {-0.4375, -0.5, 0.34, 0.4375, -0.4375, 0.49},
      {-0.4375, 0.4375, 0.34, 0.4375, 0.5, 0.49},
      {-0.03125, -0.4375, 0.355, 0.03125, 0.4375, 0.46},
      {-0.4375, -0.03125, 0.345, 0.4375, 0.03125, 0.47},
      {-0.4375, -0.4375, 0.40, 0.4375, 0.4375, 0.405}, -- actual thin glazing
    }, {use_texture_alpha = 'blend', groups = {cracky = 3, oddly_breakable_by_hand = 2}}))

  local curtain_boxes = {{-0.5, -0.5, 0.39, 0.5, 0.5, 0.49}}
  for i = 0, 7 do
    curtain_boxes[#curtain_boxes + 1] = {-0.5+i/8, -0.5, 0.24,
      -0.5+i/8+0.075, 0.5, 0.40}
  end
  add('curtain', shaped('Pleated wine-red damask curtain', {texture('curtain')}, curtain_boxes))
  add('curtain_valance', shaped('Wine-red curtain pelmet',
    faces('curtain', 'brass', 'curtain'), {
      {-0.5, 0.20, 0.15, 0.5, 0.5, 0.49},
      {-0.5, 0.13, 0.15, -0.25, 0.20, 0.42},
      {-0.25, 0.09, 0.15, 0.25, 0.20, 0.42},
      {0.25, 0.13, 0.15, 0.5, 0.20, 0.42},
    }))
  local header_boxes = copy(curtain_boxes)
  for _,box in ipairs(definitions['society:curtain_valance'].node_box.fixed) do
    header_boxes[#header_boxes+1]=copy(box)
  end
  add('curtain_header', shaped('Continuous curtain and pelmet end', {texture('curtain')}, header_boxes))

  add('mantel', shaped('Carved walnut mantel shelf',
    faces('walnut', 'walnut', 'walnut', 'walnut', 'panelling'), {
      {-0.5, 0.34, -0.32, 0.5, 0.5, 0.5}, -- continuous across X cells
      {-0.5, 0.24, -0.25, 0.5, 0.34, 0.5},
      {-0.5, -0.30, 0.22, 0.5, 0.24, 0.5}, -- recessed carved frieze
      {-0.47, -0.45, 0.11, -0.32, 0.24, 0.42}, -- stepped corbels
      {0.32, -0.45, 0.11, 0.47, 0.24, 0.42},
      {-0.43, -0.20, -0.02, -0.34, 0.24, 0.22},
      {0.34, -0.20, -0.02, 0.43, 0.24, 0.22},
    }))
  add('fireplace_pier', shaped('Carved walnut fireplace jamb',
    faces('walnut','walnut','panelling','walnut','panelling'), {
      {-0.33,-0.5,-0.22,0.33,-0.30,0.49},
      {-0.25,-0.30,-0.13,0.25,0.63,0.49},
      {-0.30,0.63,-0.19,0.30,0.78,0.49},
      {-0.35,0.78,-0.24,0.35,0.92,0.49},
    }))
  add('hearth_fire', shaped('Ember fire in iron grate',
    faces('iron', 'iron', 'iron', 'fire', 'fire'), {
      {-0.5,-0.49,0.42,0.5,0.70,0.49}, -- black firebox backing
      {-0.39, -0.49, -0.28, 0.39, -0.40, 0.32}, -- grate foot
      {-0.32, -0.40, -0.12, -0.08, -0.02, 0.12}, -- three stepped flame volumes
      {-0.10, -0.40, -0.06, 0.10, 0.23, 0.15},
      {0.12, -0.40, -0.10, 0.29, 0.10, 0.16},
      {-0.35, -0.27, -0.29, 0.35, -0.21, -0.24}, -- front grate crossbar
      {-0.34, -0.40, -0.29, -0.30, -0.09, -0.24},
      {-0.16, -0.40, -0.29, -0.12, -0.09, -0.24},
      {0.12, -0.40, -0.29, 0.16, -0.09, -0.24},
      {0.30, -0.40, -0.29, 0.34, -0.09, -0.24},
    }, {light_source = 12, walkable = false,
      collision_box = {type = 'fixed', fixed = {}}, groups = {cracky = 3}}))

  add('clock', shaped('Brass mantel clock',
    faces('brass', 'brass', 'brass', 'walnut', 'clock'), {
      {-0.30, -0.49, -0.09, 0.30, -0.43, 0.24},
      {-0.25, -0.43, -0.04, 0.25, -0.38, 0.20},
      {-0.23, -0.38, -0.035, 0.23, 0.02, 0.18},
      {-0.18, 0.02, -0.02, 0.18, 0.11, 0.17},
      {-0.11, 0.11, -0.005, 0.11, 0.15, 0.15},
    }))
  add('painting', shaped('Gilt-framed riverside landscape',
    faces('brass', 'brass', 'brass', 'walnut', 'landscape'), {
      {-0.5, -0.5, 0.36, -0.375, 0.5, 0.495}, -- four solid projecting frame rails
      {0.375, -0.5, 0.36, 0.5, 0.5, 0.495},
      {-0.375, -0.5, 0.36, 0.375, -0.375, 0.495},
      {-0.375, 0.375, 0.36, 0.375, 0.5, 0.495},
      {-0.375, -0.375, 0.435, 0.375, 0.375, 0.49}, -- inset canvas
    }))
  add('large_painting', shaped('Gilt landscape above the mantel',
    faces('brass','brass','brass','walnut','landscape'), {
      {-0.90,-0.80,0.36,-0.76,0.30,0.495},
      {0.76,-0.80,0.36,0.90,0.30,0.495},
      {-0.76,-0.80,0.36,0.76,-0.66,0.495},
      {-0.76,0.16,0.36,0.76,0.30,0.495},
      {-0.76,-0.66,0.435,0.76,0.16,0.49},
    }))
  definitions['society:large_painting'].drawtype = 'mesh'
  definitions['society:large_painting'].mesh = 'society_interior_painting.obj'
  definitions['society:large_painting'].tiles = {texture('landscape')}
  add('wall_lamp', shaped('Brass wall sconce with opal glass',
    faces('plaster','brass','brass'), {
      {-0.10,-0.30,0.36,0.10,0.24,0.49},
      {-0.035,-0.22,-0.03,0.035,-0.15,0.40},
      {-0.16,-0.16,-0.16,0.16,-0.09,0.16},
      {-0.13,-0.09,-0.13,0.13,0.18,0.13},
      {-0.08,0.18,-0.08,0.08,0.24,0.08},
    }, {light_source=13,walkable=false,collision_box={type='fixed',fixed={}}}))
  add('ceiling_lamp', shaped('Brass pendant with ivory glass shade',
    faces('brass','plaster','plaster'), {
      {-0.12,0.39,-0.12,0.12,0.5,0.12},
      {-0.025,0.04,-0.025,0.025,0.39,0.025},
      {-0.26,-0.02,-0.26,0.26,0.06,0.26},
      {-0.34,-0.18,-0.34,0.34,-0.02,0.34},
      {-0.26,-0.28,-0.26,0.26,-0.18,0.26},
      {-0.12,-0.32,-0.12,0.12,-0.28,0.12},
    }, {light_source=14,walkable=false,collision_box={type='fixed',fixed={}}}))
  add('side_table', shaped('Walnut pedestal side table',
    faces('table_top', 'walnut', 'walnut'), {
      {-0.37, 0.25, -0.35, 0.37, 0.35, 0.35},
      {-0.29, 0.19, -0.27, 0.29, 0.25, 0.27},
      {-0.10, -0.36, -0.10, 0.10, 0.19, 0.10},
      {-0.15, -0.42, -0.15, 0.15, -0.30, 0.15},
      {-0.32, -0.5, -0.09, 0.32, -0.42, 0.09},
      {-0.09, -0.5, -0.30, 0.09, -0.42, 0.30},
    }))

  return definitions
end

function M.register(engine)
  assert(type(engine) == 'table' and type(engine.register_node) == 'function',
    'interior nodes require engine.register_node')
  local definitions = M.definitions()
  local names = {}
  for name in pairs(definitions) do names[#names + 1] = name end
  table.sort(names)
  for _, name in ipairs(names) do engine.register_node(name, definitions[name]) end
end

return M
