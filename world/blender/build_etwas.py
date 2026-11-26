"""Build the editable Etwas scene and its Godot glTF from Blender 4.5."""
from math import atan2, cos, exp, pi, sin, sqrt, tau
from pathlib import Path
from random import Random

import bpy
from mathutils import Vector
from mathutils.noise import noise_vector

WORLD = Path(__file__).resolve().parents[1]
RNG = Random(27031)
POOL = (1.25, 1.15)
WATER_LEVEL = -0.115

def linear(channel):
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def paint(hex_color):
    return Vector([linear(int(hex_color[i:i + 2], 16) / 255) for i in (0, 2, 4)])


def matte(name, hex_color, roughness=0.92):
    rgb = paint(hex_color)
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*rgb, 1)
    material.use_nodes = True
    graph = material.node_tree
    graph.nodes.clear()
    surface = graph.nodes.new("ShaderNodeBsdfPrincipled")
    output = graph.nodes.new("ShaderNodeOutputMaterial")
    graph.links.new(surface.outputs["BSDF"], output.inputs["Surface"])
    surface.inputs["Base Color"].default_value = (*rgb, 1)
    surface.inputs["Roughness"].default_value = roughness
    return material


def painted_surface(name):
    material = matte(name, "ffffff")
    graph = material.node_tree
    pigment = graph.nodes.new("ShaderNodeVertexColor")
    pigment.layer_name = "Pigment"
    surface = next(node for node in graph.nodes if node.type == "BSDF_PRINCIPLED")
    graph.links.new(pigment.outputs["Color"], surface.inputs["Base Color"])
    return material


def collection(name):
    group = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(group)
    return group


def mesh(group, name, vertices, faces, materials, colors=None, smooth=False):
    geometry = bpy.data.meshes.new(name)
    geometry.from_pydata(vertices, [], faces)
    geometry.update()
    instance = bpy.data.objects.new(name, geometry)
    group.objects.link(instance)
    for material in materials:
        geometry.materials.append(material)
    for face in geometry.polygons:
        if colors is not None:
            face.material_index = colors[face.index]
        face.use_smooth = smooth
    return instance


def tint_vertices(instance, colors):
    pigment = instance.data.color_attributes.new(name="Pigment", type="FLOAT_COLOR", domain="POINT")
    pigment.data.foreach_set("color", [channel for rgb in colors for channel in (*rgb, 1.0)])


def ground_noise(x, y):
    return noise_vector((x * 0.36, y * 0.36, 0.3))[0]


def pool_edge(angle):
    return 1 + 0.075 * cos(3 * angle + 0.4) + 0.047 * sin(5 * angle - 0.7)


def pool_radius(x, y):
    dx, dy = (x - POOL[0]) / 2.24, (y - POOL[1]) / 1.48
    return sqrt(dx * dx + dy * dy) / pool_edge(atan2(dy, dx))


def trail_center(y):
    return -2.20 - 1.68 * exp(-((y + 5.6) / 2.45) ** 2)


def ease(value):
    t = max(0, min(value, 1))
    return t * t * (3 - 2 * t)


def height(x, y):
    ring = pool_radius(x, y)
    shelf = 0.05 + ground_noise(x, y) * 0.16
    spring = -0.43 + ease((ring - 0.52) / 0.53) * 0.49
    altitude = spring + (shelf - spring) * ease((ring - 1.02) / 0.52)
    crest = 6.2 + 0.72 * cos(x * 0.44) - 0.36 * sin(x * 0.78)
    return altitude - max(y - crest, 0) ** 1.35 * 1.42 + 0.30 * min(max(-y - 6.1, 0), 3.6)


def build_shelf(group):
    columns, rows = 151, 161
    vertices, colors, faces = [], [], []
    shade, turf = paint("4d4c41"), paint("85805c")
    dust, shale, wet = paint("977d69"), paint("b29b87"), paint("736055")
    for row in range(rows):
        y = -13 + row * 0.18
        for column in range(columns):
            x = (column - (columns - 1) / 2) * 0.18
            z = height(x, y)
            vertices.append((x, y, z))
            grain = ground_noise(x * 4.6, y * 4.6)
            mottling = 0.48 + 0.66 * ground_noise(x + 4, y - 6) + 0.12 * grain
            color = shade.lerp(turf, ease(mottling))
            gravel = dust.lerp(shale, ease(0.48 + grain * 0.82))
            trail = 1 - ease((abs(x - trail_center(y)) - 0.39 - mottling * 0.22) / 0.48)
            bank = 1 - ease((pool_radius(x, y) - 0.92 - grain * 0.07) / 0.30)
            color = color.lerp(gravel, trail * (1 - ease((y + 1.0) / 1.6)))
            color = color.lerp(gravel, ease((y - 5.9) / 1.6) * ease(-z * 1.6))
            damp = 1 - ease((z - WATER_LEVEL + 0.02) / 0.13)
            colors.append(color.lerp(gravel.lerp(wet, damp), bank))
    for row in range(rows - 1):
        for column in range(columns - 1):
            a = row * columns + column
            faces.append((a, a + 1, a + columns + 1, a + columns))
    shelf = mesh(group, "WALK_SpringShelf", vertices, faces, [painted_surface("Painted shelf")], smooth=True)
    tint_vertices(shelf, colors)


def rock(group, name, location, size, materials, angle=0.0):
    # Offset successive strata, then chamfer the top and the foot of the outcrop.
    sides = RNG.choice((7, 8, 9))
    outline = [RNG.uniform(0.77, 1.13) for _ in range(sides)]
    rings = [(0.76, -0.13), (1.0, 0.14), (0.95, 0.51), (0.84, 0.73), (0.60, 1.0)]
    x, y, z = location
    sx, sy, sz = size
    vertices = []
    for radius, elevation in rings:
        for side, shape in enumerate(outline):
            phase = side * tau / sides + angle
            drift = 0.17 * elevation
            vertices.append((
                x + sx * (radius * shape * cos(phase) + drift),
                y + sy * (radius * shape * sin(phase) - drift * 0.5),
                z + sz * (elevation + RNG.uniform(-0.085, 0.085) + 0.10 * sin(phase)),
            ))
    faces = [tuple(range(sides - 1, -1, -1))]
    colors = [0]
    for ring in range(len(rings) - 1):
        for side in range(sides):
            i, j = ring * sides + side, ring * sides + (side + 1) % sides
            faces.append((i, j, j + sides, i + sides))
            colors.append(RNG.choice((0, 0, 1)) if ring == 0 else RNG.choice((1, 1, 2, 3)))
    faces.append(tuple(range((len(rings) - 1) * sides, len(rings) * sides)))
    colors.append(RNG.choice((2, 3)))
    return mesh(group, name, vertices, faces, materials, colors)


def build_outcrops(group, slate, mineral):
    # The bend is screened by a slanted stack on the uphill side.
    for index, (x, y, sx, sy, sz) in enumerate((
        (-6.6, -8.7, 2.7, 2.9, 4.5), (-1.18, -7.2, 1.52, 3.22, 3.85),
        (-1.55, -5.8, 1.16, 1.44, 2.9), (-6.65, -5.65, 1.8, 2.2, 3.0),
        (-0.22, -6.16, 1.62, 2.2, 3.26), (-1.00, -4.00, 0.83, 1.7, 1.96),
        (-5.2, -2.6, 1.67, 2.3, 2.4), (-6.4, 1.7, 2.67, 3.2, 3.36),
        (5.7, -0.55, 1.55, 2.21, 1.2), (6.7, 2.9, 1.97, 2.65, 1.05),
        (8.1, 4.8, 2.64, 2.9, 1.2), (-7.3, 5.1, 2.2, 2.6, 1.15),
    )):
        rock(group, f"OBSTACLE_Schist{index + 1:02}", (x, y, height(x, y) - 0.12),
             (sx, sy, sz), slate, index * 0.44)

    for index in range(27):
        angle = index * tau / 27 + RNG.uniform(-0.055, 0.055)
        if index in (2, 3, 7, 10, 11, 15, 16, 17, 21, 25):
            continue
        rim = pool_edge(angle) * RNG.uniform(0.97, 1.10)
        x, y = POOL[0] + 2.24 * rim * cos(angle), POOL[1] + 1.48 * rim * sin(angle)
        rock(group, f"Mineral rim {index + 1:02}", (x, y, height(x, y) - 0.035),
             (RNG.uniform(0.26, 0.68), RNG.uniform(0.18, 0.46), RNG.uniform(0.06, 0.16)),
             mineral, angle)
    rock(group, "HIT_SeatLedge", (0.72, -0.75, -0.03), (1.40, 0.47, 0.28), mineral, 0.12)
    for index in range(24):
        angle = index * tau / 24
        radius = RNG.uniform(0.28, 0.78)
        x = POOL[0] + 2.24 * radius * cos(angle)
        y = POOL[1] + 1.48 * radius * sin(angle)
        size = RNG.uniform(0.11, 0.25)
        rock(group, f"Submerged stone {index + 1:02}", (x, y, height(x, y) - 0.025),
             (size, size * 0.73, size * 0.18), mineral, angle)

    for index in range(62):
        y = RNG.uniform(-10.5, 5.9)
        x = RNG.uniform(-9, 9)
        if pool_radius(x, y) < 1.17 or abs(x - trail_center(y)) < 0.57 and y < 0.4:
            continue
        size = RNG.uniform(0.07, 0.31)
        rock(group, f"Scree {index + 1:02}", (x, y, height(x, y)),
             (size * 1.4, size, size * 0.65), slate, RNG.uniform(0, tau))


def build_vegetation(group):
    vertices, faces, colors, weights = [], [], [], []
    root_tint = paint("3e5034")
    green_tip, straw_tip = paint("92a360"), paint("bdab66")
    planting = Random(3131)
    for _ in range(2850):
        x, y = planting.uniform(-12, 12), planting.uniform(-11, 6.4)
        edge = abs(x - trail_center(y)) if y < 0.6 else 2.0
        radius = pool_radius(x, y)
        if radius < 1.10 or edge < planting.uniform(0.64, 0.95):
            continue
        patch = ease(0.49 + 1.32 * ground_noise(x * 0.54, y * 0.54))
        if planting.random() > 0.1 + 0.82 * patch:
            continue
        wetness = 1 - ease((radius - 1.10) / 0.50)
        tip = green_tip.lerp(straw_tip, planting.uniform(0.05, 0.74) * (1 - wetness))
        for _ in range(planting.randint(5, 9)):
            ox, oy = x + planting.uniform(-0.082, 0.082), y + planting.uniform(-0.082, 0.082)
            z = height(ox, oy)
            angle = planting.uniform(0, tau)
            width = planting.uniform(0.010, 0.020)
            h = planting.uniform(0.085, 0.24) * (0.72 + wetness * 0.46 + patch * 0.32)
            side_x, side_y = cos(angle) * width, sin(angle) * width
            bend = h * planting.uniform(0.31, 0.79)
            i = len(vertices)
            for t, taper in ((0.0, 0.65), (0.36, 1.0), (0.70, 0.55)):
                arch = bend * t * t
                cx, cy = ox + sin(angle) * arch, oy - cos(angle) * arch
                for side in (-1, 1):
                    vertices.append((cx + side_x * side * taper, cy + side_y * side * taper, z + h * t))
                    colors.append(root_tint.lerp(tip, t))
                    weights.append(t)
            vertices.append((ox + sin(angle) * bend, oy - cos(angle) * bend, z + h * 0.89))
            colors.append(tip)
            weights.append(1.0)
            faces.extend(((i, i + 1, i + 3, i + 2), (i + 2, i + 3, i + 5, i + 4), (i + 4, i + 5, i + 6)))
    grass = mesh(group, "Alpine grass blades", vertices, faces, [painted_surface("Painted blades")])
    tint_vertices(grass, colors)
    uv = grass.data.uv_layers.new(name="Blade weight")
    uv.data.foreach_set("uv", [coordinate for loop in grass.data.loops for coordinate in (0.0, 1.0 - weights[loop.vertex_index])])


def build_valley(group, materials):
    # Low ridges share the horizon; deeper ridges lose contrast in the Godot aerial haze.
    for layer, (depth, width, floor, amplitude) in enumerate((
        (27, 138, -21, 19), (52, 166, -33, 29), (85, 220, -39, 38), (126, 300, -55, 55),
    )):
        columns, rows = 121, 15
        points, faces = [], []
        for row in range(rows):
            t = row / (rows - 1)
            for column in range(columns):
                x = (column / (columns - 1) - 0.5) * width
                n = noise_vector((x * 0.039, layer * 0.81, 0.71))[0]
                detail = noise_vector((x * 0.117, layer * 0.63, 1.4))[2]
                rhythm = sin(x * 0.039 + layer * 1.62 + 0.61 * cos(x * 0.019))
                crest = 0.39 + 0.34 * abs(rhythm) + n * 0.42 + 0.06 * sin(x * 0.081)
                if layer in (2, 3):
                    crest += 0.37 * exp(-((x - (7.0 - layer * 8.0)) / 17.0) ** 2)
                slope = sin(pi * t) ** 1.28
                z = floor + (amplitude * crest + detail * 3.1) * slope
                z += noise_vector((x * 0.14, t * 10, layer * 1.3))[1] * slope * 2.6
                points.append((x + t * 5.5, depth + t * (19 + layer * 5), z))
        for row in range(rows - 1):
            for column in range(columns - 1):
                a = row * columns + column
                faces.append((a, a + 1, a + columns + 1, a + columns))
        mesh(group, f"Valley ridge {layer + 1}", points, faces, [materials[layer]], smooth=True)


def build_water_patch(group, material):
    vertices = [(POOL[0], POOL[1], WATER_LEVEL)]
    for index in range(96):
        angle = index * tau / 96
        r = pool_edge(angle) * 1.06
        vertices.append((POOL[0] + cos(angle) * 2.24 * r, POOL[1] + sin(angle) * 1.48 * r, WATER_LEVEL))
    faces = [(0, index + 1, (index + 1) % 96 + 1) for index in range(96)]
    mesh(group, "SpringSurface", vertices, faces, [material])


def frame_source_file():
    focus = Vector((0.8, 1.2, -0.2))
    eye = Vector((-4.2, -4.8, 3.9))
    rotation = (focus - eye).to_track_quat("-Z", "Y")
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            viewport = area.spaces.active
            viewport.clip_end = 400
            viewport.shading.color_type = "MATERIAL"
            viewport.region_3d.view_location = focus
            viewport.region_3d.view_rotation = rotation
            viewport.region_3d.view_distance = (focus - eye).length


def save(name, asset):
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(WORLD / "blender" / (name + ".blend")), compress=True)
    bpy.ops.export_scene.gltf(filepath=str(WORLD / "assets" / "etwas" / (asset + ".glb")), export_format="GLB")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    slate = [matte(f"Schist {i + 1}", color) for i, color in enumerate(("55535d", "6d6266", "857573", "9a867c"))]
    mineral = [matte(f"Spring stone {i + 1}", color) for i, color in enumerate(("74635b", "aa8d75", "b9a092", "c6aa91"))]
    ridges = [matte(f"Valley ridge {i + 1}", color) for i, color in enumerate(("4b565e", "535f79", "656b90", "857d9c"))]
    build_shelf(collection("Carved shelf and basin"))
    build_outcrops(collection("Schist and mineral edge"), slate, mineral)
    build_vegetation(collection("Alpine grass"))
    build_valley(collection("Distant ridges"), ridges)
    build_water_patch(collection("Water surface"), matte("Spring water preview", "698984", 0.19))
    frame_source_file()
    save("etwas", "etwas")


if __name__ == "__main__":
    main()
