"""Build the editable Etwas riverside town and its Godot-ready GLB.

Run with Blender 4.5 in background mode:
    blender -b --factory-startup --python world/blender/build_etwas_town.py

Coordinates are authored in Godot space (X east, Y up, Z south), then mapped to
Blender space before glTF export. The main town and its integration interfaces
are deliberately kept in this file so the scene can be rebuilt as one unit.
"""

from math import atan2, ceil, cos, pi, sin, sqrt, tau
from pathlib import Path
from random import Random

import bpy
import bmesh
from mathutils import Vector


WORLD = Path(__file__).resolve().parents[1]
BLEND_PATH = WORLD / "blender" / "etwas-town.blend"
GLB_PATH = WORLD / "assets" / "etwas" / "town.glb"
RNG = Random(211026)

RIVER_WEST = -4.2
RIVER_EAST = 4.2
WEST_FLOOR = 1.5
EAST_FLOOR = 2.6
LOW_QUAY_FLOOR = 0.48
BANK_Z_MIN = -30.0
BANK_Z_MAX = 27.0
STAIR_X0 = 5.15
STAIR_X1 = 6.55
LOW_QUAY_X1 = 11.5
LOW_QUAY_Z0 = 13.0
LOW_QUAY_Z1 = 16.0


def g2b(point):
    """Convert one Godot (x, y, z) point to Blender (x, y, z)."""
    x, y, z = point
    return (x, -z, y)


def srgb_channel(value):
    value /= 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def make_material(name, color, roughness=0.86, metallic=0.0, emission=None):
    rgb = tuple(srgb_channel(int(color[index:index + 2], 16)) for index in (0, 2, 4))
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*rgb, 1.0)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    surface = nodes.new("ShaderNodeBsdfPrincipled")
    output = nodes.new("ShaderNodeOutputMaterial")
    material.node_tree.links.new(surface.outputs["BSDF"], output.inputs["Surface"])
    surface.inputs["Base Color"].default_value = (*rgb, 1.0)
    surface.inputs["Roughness"].default_value = roughness
    surface.inputs["Metallic"].default_value = metallic
    if emission is not None:
        emit = tuple(srgb_channel(int(emission[index:index + 2], 16)) for index in (0, 2, 4))
        if "Emission Color" in surface.inputs:
            surface.inputs["Emission Color"].default_value = (*emit, 1.0)
            surface.inputs["Emission Strength"].default_value = 1.35
    return material


def create_materials():
    palette = {
        "limestone": ("a79a83", 0.9, 0.0, None),
        "limestone_light": ("c4b69a", 0.88, 0.0, None),
        "limestone_shade": ("817765", 0.93, 0.0, None),
        "river_stone": ("716e68", 0.95, 0.0, None),
        "river_stone_light": ("90897c", 0.92, 0.0, None),
        "wet_stone": ("484b49", 0.32, 0.0, None),
        "mortar": ("504e49", 0.97, 0.0, None),
        "plaster_cream": ("c8b99a", 0.93, 0.0, None),
        "plaster_sage": ("9da58b", 0.92, 0.0, None),
        "plaster_rose": ("b98c73", 0.92, 0.0, None),
        "timber_dark": ("493326", 0.82, 0.0, None),
        "timber": ("76543a", 0.82, 0.0, None),
        "timber_light": ("a17b51", 0.84, 0.0, None),
        "wood_floor": ("725840", 0.88, 0.0, None),
        "wood_floor_light": ("917353", 0.9, 0.0, None),
        "roof_slate": ("535f66", 0.78, 0.0, None),
        "roof_slate_light": ("748087", 0.78, 0.0, None),
        "roof_terra": ("8f4937", 0.84, 0.0, None),
        "roof_terra_light": ("b76548", 0.84, 0.0, None),
        "roof_terra_dark": ("69382f", 0.9, 0.0, None),
        "roof_moss": ("687052", 0.94, 0.0, None),
        "iron": ("333d3d", 0.45, 0.72, None),
        "brass": ("b28a4e", 0.38, 0.72, None),
        "warm_glow": ("f4c77c", 0.3, 0.0, "f5b35f"),
        "cool_glass": ("536b6c", 0.25, 0.12, None),
        "linen": ("bca982", 0.96, 0.0, None),
        "basket": ("8c6743", 0.95, 0.0, None),
        "soil": ("5b4f3a", 0.96, 0.0, None),
        "moss": ("657457", 0.97, 0.0, None),
        "grass": ("707b52", 0.97, 0.0, None),
        "water": ("526c6d", 0.22, 0.14, None),
        "cobble_1": ("9a907e", 0.93, 0.0, None),
        "cobble_2": ("817c70", 0.94, 0.0, None),
        "cobble_3": ("b0a38c", 0.91, 0.0, None),
        "cobble_4": ("6f706b", 0.94, 0.0, None),
        "cobble_5": ("a59b89", 0.92, 0.0, None),
    }
    return {
        key: make_material(key.replace("_", " ").title(), color, roughness, metallic, emission)
        for key, (color, roughness, metallic, emission) in palette.items()
    }


class MeshBuilder:
    """Batch readable, named geometry into one export object."""

    def __init__(self, name, collection, materials):
        self.name = name
        self.collection = collection
        self.materials = list(materials)
        self.vertices = []
        self.faces = []
        self.material_ids = []
        self.material_lookup = {material.name: index for index, material in enumerate(self.materials)}

    def material_id(self, material):
        if isinstance(material, str):
            material = MAT[material]
        if material.name not in self.material_lookup:
            self.material_lookup[material.name] = len(self.materials)
            self.materials.append(material)
        return self.material_lookup[material.name]

    def add_mesh(self, vertices, faces, material):
        start = len(self.vertices)
        self.vertices.extend(tuple(point) for point in vertices)
        self.faces.extend(tuple(start + index for index in face) for face in faces)
        self.material_ids.extend([self.material_id(material)] * len(faces))

    def box(self, center, size, material, rx=0.0, ry=0.0):
        cx, cy, cz = center
        sx, sy, sz = size
        half = (sx * 0.5, sy * 0.5, sz * 0.5)
        corners = [
            (-half[0], -half[1], -half[2]),
            (half[0], -half[1], -half[2]),
            (half[0], half[1], -half[2]),
            (-half[0], half[1], -half[2]),
            (-half[0], -half[1], half[2]),
            (half[0], -half[1], half[2]),
            (half[0], half[1], half[2]),
            (-half[0], half[1], half[2]),
        ]
        crx, srx = cos(rx), sin(rx)
        cry, sry = cos(ry), sin(ry)
        vertices = []
        for x, y, z in corners:
            y, z = crx * y - srx * z, srx * y + crx * z
            x, z = cry * x + sry * z, -sry * x + cry * z
            vertices.append((cx + x, cy + y, cz + z))
        faces = (
            (0, 3, 2, 1), (4, 5, 6, 7), (0, 4, 7, 3),
            (1, 2, 6, 5), (0, 1, 5, 4), (3, 7, 6, 2),
        )
        self.add_mesh(vertices, faces, material)

    def prism(self, polygon, offset, material):
        count = len(polygon)
        vertices = list(polygon) + [
            (point[0] + offset[0], point[1] + offset[1], point[2] + offset[2])
            for point in polygon
        ]
        faces = [tuple(range(count)), tuple(range(count, count * 2))[::-1]]
        for index in range(count):
            following = (index + 1) % count
            faces.append((index, following, following + count, index + count))
        self.add_mesh(vertices, faces, material)

    def beam(self, start, end, width, depth, material):
        a, b = Vector(start), Vector(end)
        axis = b - a
        if axis.length < 1e-5:
            return
        axis.normalize()
        reference = Vector((0.0, 1.0, 0.0))
        if abs(axis.dot(reference)) > 0.94:
            reference = Vector((1.0, 0.0, 0.0))
        side = axis.cross(reference).normalized()
        normal = axis.cross(side).normalized()
        center = (a + b) * 0.5
        along = axis * (b - a).length * 0.5
        across = side * width * 0.5
        thick = normal * depth * 0.5
        vertices = []
        for along_sign, side_sign, normal_sign in (
            (-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
            (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1),
        ):
            point = center + along * along_sign + across * side_sign + thick * normal_sign
            vertices.append(tuple(point))
        faces = (
            (0, 3, 2, 1), (4, 5, 6, 7), (0, 4, 7, 3),
            (1, 2, 6, 5), (0, 1, 5, 4), (3, 7, 6, 2),
        )
        self.add_mesh(vertices, faces, material)

    def ellipsoid(self, center, size, material, segments=12, rings=7):
        cx, cy, cz = center
        sx, sy, sz = size
        vertices = [(cx, cy - sy * 0.5, cz)]
        for ring in range(1, rings):
            latitude = -pi * 0.5 + pi * ring / rings
            for segment in range(segments):
                longitude = tau * segment / segments
                vertices.append((
                    cx + sx * 0.5 * cos(latitude) * cos(longitude),
                    cy + sy * 0.5 * sin(latitude),
                    cz + sz * 0.5 * cos(latitude) * sin(longitude),
                ))
        top_index = len(vertices)
        vertices.append((cx, cy + sy * 0.5, cz))
        faces = []
        first_ring = 1
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((0, first_ring + following, first_ring + segment))
        for ring in range(rings - 2):
            start = first_ring + ring * segments
            for segment in range(segments):
                a = start + segment
                b = start + (segment + 1) % segments
                faces.append((a, b, b + segments, a + segments))
        last_ring = first_ring + (rings - 2) * segments
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((last_ring + segment, last_ring + following, top_index))
        self.add_mesh(vertices, faces, material)

    def create(self):
        if not self.faces:
            return None
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata([g2b(point) for point in self.vertices], [], self.faces)
        mesh.update()
        for material in self.materials:
            mesh.materials.append(material)
        for index, polygon in enumerate(mesh.polygons):
            polygon.material_index = self.material_ids[index]
        bmesh_data = bmesh.new()
        bmesh_data.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bmesh_data, faces=bmesh_data.faces)
        bmesh_data.to_mesh(mesh)
        bmesh_data.free()
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        self.collection.objects.link(obj)
        return obj


def add_box_layer(builder, x0, x1, z0, z1, top, thickness, material):
    builder.box(((x0 + x1) * 0.5, top - thickness * 0.5, (z0 + z1) * 0.5),
                (x1 - x0, thickness, z1 - z0), material)


def add_cobbles(builder, x0, x1, z0, z1, y, rng, x_step=0.52, z_step=0.48):
    """Hand-laid stone pavers with restrained size and color variation."""
    row = 0
    z = z0 + z_step * 0.5
    while z < z1:
        offset = (row % 2) * x_step * 0.5
        x = x0 + x_step * 0.5 + offset
        while x < x1:
            material = rng.choice((
                MAT["cobble_1"], MAT["cobble_1"], MAT["cobble_2"],
                MAT["cobble_3"], MAT["cobble_4"], MAT["cobble_5"],
            ))
            width = x_step * rng.uniform(0.76, 0.94)
            depth = z_step * rng.uniform(0.76, 0.93)
            builder.box(
                (x + rng.uniform(-0.018, 0.018), y + 0.035, z + rng.uniform(-0.018, 0.018)),
                (width, 0.075, depth), material,
                ry=rng.uniform(-0.025, 0.025),
            )
            x += x_step
        z += z_step
        row += 1


def build_terrace_edge(builder, axis, fixed, start, end, top, bottom, thickness, seed):
    rng = Random(seed)
    course_height = 0.42
    level = bottom
    course = 0
    while level < top - 0.025:
        height = min(course_height, top - level)
        block_length = 0.92 if course % 2 == 0 else 0.76
        offset = 0.0
        while start + offset < end - 0.025:
            length = min(block_length + rng.uniform(-0.06, 0.06), end - start - offset)
            along = start + offset + length * 0.5
            center_y = level + height * 0.5
            center = (fixed, center_y, along) if axis == "x" else (along, center_y, fixed)
            size = (thickness, height - 0.025, length - 0.035) if axis == "x" else \
                (length - 0.035, height - 0.025, thickness)
            builder.box(center, size, rng.choice((MAT["river_stone"], MAT["river_stone_light"],
                                                  MAT["limestone_shade"])))
            offset += block_length
        level += course_height
        course += 1

    offset = 0.0
    while start + offset < end - 0.02:
        length = min(1.05, end - start - offset)
        along = start + offset + length * 0.5
        center = (fixed, top + 0.045, along) if axis == "x" else (along, top + 0.045, fixed)
        size = (thickness + 0.16, 0.09, length - 0.03) if axis == "x" else \
            (length - 0.03, 0.09, thickness + 0.16)
        builder.box(center, size, rng.choice((MAT["limestone"], MAT["limestone_light"])))
        offset += 1.05


def make_collection(name, parent):
    collection = bpy.data.collections.new(name)
    parent.children.link(collection)
    return collection


def build_banks(collections):
    ground = MeshBuilder("WALK_Bank terraces and river approaches", collections["ground"], [MAT["limestone"]])
    paving = MeshBuilder("VISUAL_Cobble lanes and bridge aprons", collections["details"], [])
    quay = MeshBuilder("OBSTACLE_Layered river quay walls", collections["quay"], [])
    wet_edge = MeshBuilder("VISUAL_Wet stones and moss at waterline", collections["details"], [])

    # The solid pads overlap the integration cut edge, while the walkable bank tops
    # stay nearly level with the agreed valley floors.
    add_box_layer(ground, -20.0, RIVER_WEST, BANK_Z_MIN, BANK_Z_MAX,
                  WEST_FLOOR, 0.62, MAT["limestone"])
    add_box_layer(ground, RIVER_EAST, 20.0, BANK_Z_MIN, 7.0,
                  EAST_FLOOR, 0.75, MAT["river_stone"])
    add_box_layer(ground, RIVER_EAST, 20.0, 16.0, BANK_Z_MAX,
                  EAST_FLOOR, 0.75, MAT["river_stone"])
    add_box_layer(ground, STAIR_X1, 20.0, 7.0, 13.0,
                  EAST_FLOOR, 0.75, MAT["river_stone"])
    add_box_layer(ground, RIVER_EAST, STAIR_X0, 7.0, 13.0,
                  LOW_QUAY_FLOOR, 0.42, MAT["river_stone_light"])
    add_box_layer(ground, RIVER_EAST, LOW_QUAY_X1, LOW_QUAY_Z0, LOW_QUAY_Z1,
                  LOW_QUAY_FLOOR, 0.40, MAT["limestone"])
    add_box_layer(ground, LOW_QUAY_X1, 20.0, 13.0, 16.0,
                  EAST_FLOOR, 0.75, MAT["river_stone"])

    lane_rng = Random(211027)
    add_cobbles(paving, -7.55, -6.15, BANK_Z_MIN, BANK_Z_MAX, WEST_FLOOR + 0.03,
                lane_rng, 0.48, 0.48)
    add_cobbles(paving, 6.98, 7.78, BANK_Z_MIN, BANK_Z_MAX, EAST_FLOOR + 0.03,
                lane_rng, 0.42, 0.48)
    add_cobbles(paving, -11.0, -5.55, -4.1, 4.1, WEST_FLOOR + 0.035,
                lane_rng, 0.52, 0.50)
    add_cobbles(paving, 5.45, 10.6, -3.6, 3.6, EAST_FLOOR + 0.035,
                lane_rng, 0.50, 0.49)
    add_cobbles(paving, 4.25, LOW_QUAY_X1 - 0.08, LOW_QUAY_Z0, LOW_QUAY_Z1,
                LOW_QUAY_FLOOR + 0.025, lane_rng, 0.48, 0.46)
    add_cobbles(paving, 7.02, 7.77, 6.8, 9.2, EAST_FLOOR + 0.035,
                lane_rng, 0.42, 0.45)
    add_cobbles(paving, 7.30, 9.18, -11.1, -8.9, EAST_FLOOR + 0.035,
                lane_rng, 0.46, 0.46)

    build_quay_wall(quay, wet_edge, "west", RIVER_WEST, BANK_Z_MIN, BANK_Z_MAX,
                    WEST_FLOOR, -0.25, 0.48)
    build_quay_wall(quay, wet_edge, "east", RIVER_EAST, BANK_Z_MIN, 7.0,
                    EAST_FLOOR, 0.25, 0.48)
    build_quay_wall(quay, wet_edge, "east", RIVER_EAST, 7.0, LOW_QUAY_Z1,
                    LOW_QUAY_FLOOR, -0.16, 0.48)
    build_quay_wall(quay, wet_edge, "east", RIVER_EAST, LOW_QUAY_Z1, BANK_Z_MAX,
                    EAST_FLOOR, 0.25, 0.48)

    # Coursed dry-stone edges dress the valley-cut overlap and hold the raised pads.
    build_terrace_edge(quay, "x", -19.8, BANK_Z_MIN + 0.2, BANK_Z_MAX - 0.2,
                       WEST_FLOOR, 0.88, 0.42, 3101)
    build_terrace_edge(quay, "x", 19.8, BANK_Z_MIN + 0.2, BANK_Z_MAX - 0.2,
                       EAST_FLOOR, 1.88, 0.42, 3102)
    for z, seed in ((BANK_Z_MIN + 0.2, 3103), (BANK_Z_MAX - 0.2, 3104)):
        build_terrace_edge(quay, "z", z, -19.8, RIVER_WEST,
                           WEST_FLOOR, 0.88, 0.42, seed)
        build_terrace_edge(quay, "z", z, RIVER_EAST, 19.8,
                           EAST_FLOOR, 1.88, 0.42, seed + 20)
    build_terrace_edge(quay, "x", LOW_QUAY_X1, LOW_QUAY_Z0, LOW_QUAY_Z1,
                       EAST_FLOOR, LOW_QUAY_FLOOR, 0.46, 3105)
    build_terrace_edge(quay, "z", LOW_QUAY_Z1, RIVER_EAST, LOW_QUAY_X1,
                       EAST_FLOOR, LOW_QUAY_FLOOR, 0.46, 3106)
    # Back the stair cheek with the masonry foundation of the upper street.
    build_terrace_edge(paving, "x", STAIR_X1 + 0.22, 7.0, 13.08,
                       EAST_FLOOR, LOW_QUAY_FLOOR - 0.16, 0.42, 3108)
    paving.box((STAIR_X1 + 0.49, 1.40, 10.0), (0.46, 2.11, 6.14), MAT["mortar"])

    # Slightly raised curb stones remain visual set dressing and do not block traffic.
    for x, width, y in ((-7.95, 0.12, WEST_FLOOR), (-5.95, 0.12, WEST_FLOOR),
                        (6.76, 0.10, EAST_FLOOR), (7.98, 0.10, EAST_FLOOR)):
        z = BANK_Z_MIN
        while z < BANK_Z_MAX:
            length = min(1.0, BANK_Z_MAX - z)
            if x < -5.0 or not (5.2 < z < 13.0):
                paving.box((x, y + 0.08, z + length * 0.5), (width, 0.16, length - 0.035),
                           MAT["limestone_light"])
            z += 1.0

    # Low, irregular water-edge stones remain below ankle height and off the lanes.
    for side, edge in ((-1, RIVER_WEST), (1, RIVER_EAST)):
        for index in range(168):
            z = BANK_Z_MIN + 0.35 + index * 0.34
            if side > 0 and 7.0 <= z <= LOW_QUAY_Z1:
                top = LOW_QUAY_FLOOR
            else:
                top = WEST_FLOOR if side < 0 else EAST_FLOOR
            x = edge + side * RNG.uniform(0.16, 0.58)
            height = RNG.uniform(0.12, 0.36)
            wet_edge.ellipsoid((x, top - height * 0.43, z),
                               (RNG.uniform(0.22, 0.72), height, RNG.uniform(0.25, 0.74)),
                               RNG.choice((MAT["wet_stone"], MAT["river_stone"], MAT["moss"])),
                               segments=8, rings=5)

    ground.create()
    paving.create()
    quay.create()
    wet_edge.create()


def build_quay_wall(builder, wet_builder, side, edge, z0, z1, top, bottom, thickness):
    inner_sign = -1 if side == "west" else 1
    center_x = edge + inner_sign * thickness * 0.48
    block_rng = Random(9100 + int((z0 + 35) * 10) + (0 if side == "west" else 700))
    course_height = 0.49
    course = 0
    level = bottom
    while level < top - 0.03:
        height = min(course_height, top - level)
        block_length = 0.83 if course % 2 == 0 else 0.76
        z = z0
        while z < z1 - 0.02:
            length = min(block_length + block_rng.uniform(-0.08, 0.08), z1 - z)
            builder.box((center_x, level + height * 0.5, z + length * 0.5),
                        (thickness, height - 0.035, length - 0.035),
                        block_rng.choice((MAT["river_stone"], MAT["river_stone"],
                                          MAT["river_stone_light"], MAT["limestone_shade"])))
            z += block_length
        level += course_height
        course += 1

    cap_z = z0
    cap_materials = (MAT["limestone"], MAT["limestone_light"], MAT["river_stone_light"])
    while cap_z < z1 - 0.02:
        length = min(0.98, z1 - cap_z)
        builder.box((center_x, top + 0.055, cap_z + length * 0.5),
                    (thickness + 0.18, 0.11, length - 0.035),
                    block_rng.choice(cap_materials))
        cap_z += 0.98

    wet_count = int((z1 - z0) / 0.48)
    water_side_x = edge - inner_sign * 0.10
    for index in range(wet_count):
        z = z0 + (index + 0.5) * 0.48
        wet_builder.ellipsoid((water_side_x, max(bottom + 0.18, 0.08), z),
                              (0.20, 0.16, block_rng.uniform(0.22, 0.46)),
                              block_rng.choice((MAT["wet_stone"], MAT["moss"])),
                              segments=7, rings=4)


def build_river(collection):
    water = MeshBuilder("WATER_River surface", collection, [MAT["water"]])
    columns, rows = 11, 116
    vertices, faces = [], []
    for row in range(rows):
        z = BANK_Z_MIN - 1.0 + row * ((BANK_Z_MAX - BANK_Z_MIN + 2.0) / (rows - 1))
        for column in range(columns):
            x = RIVER_WEST + column * ((RIVER_EAST - RIVER_WEST) / (columns - 1))
            ripple = 0.012 * sin(z * 1.45 + x * 0.71) + 0.006 * cos(z * 0.51 - x * 1.8)
            vertices.append((x, 0.035 + ripple, z))
    for row in range(rows - 1):
        for column in range(columns - 1):
            a = row * columns + column
            faces.append((a, a + columns, a + columns + 1, a + 1))
    water.add_mesh(vertices, faces, MAT["water"])
    water.create()


def bridge_deck_height(x):
    if x <= RIVER_WEST:
        return WEST_FLOOR
    if x >= RIVER_EAST:
        return EAST_FLOOR
    return WEST_FLOOR + (x - RIVER_WEST) / (RIVER_EAST - RIVER_WEST) * (EAST_FLOOR - WEST_FLOOR)


def add_sloped_bridge_slab(builder, x0, x1, z0, z1, thickness):
    count = 33
    xs = [x0 + (x1 - x0) * index / (count - 1) for index in range(count)]
    vertices = []
    for z in (z0, z1):
        vertices.extend((x, bridge_deck_height(x), z) for x in xs)
    for z in (z0, z1):
        vertices.extend((x, bridge_deck_height(x) - thickness, z) for x in xs)

    front_top = 0
    back_top = count
    front_bottom = count * 2
    back_bottom = count * 3
    faces = []
    for index in range(count - 1):
        next_index = index + 1
        faces.append((front_top + index, back_top + index,
                      back_top + next_index, front_top + next_index))
        faces.append((front_bottom + index, front_bottom + next_index,
                      back_bottom + next_index, back_bottom + index))
        faces.append((front_top + index, front_top + next_index,
                      front_bottom + next_index, front_bottom + index))
        faces.append((back_top + index, back_bottom + index,
                      back_bottom + next_index, back_top + next_index))
    faces.append((front_top, front_bottom, back_bottom, back_top))
    last = count - 1
    faces.append((front_top + last, back_top + last,
                  back_bottom + last, front_bottom + last))
    builder.add_mesh(vertices, faces, MAT["river_stone"])


def arch_intrados(x):
    ratio = min(0.9999, abs(x) / 4.5)
    return 0.35 + 1.2 * sqrt(1.0 - ratio * ratio)


def build_bridge(collections):
    masonry = MeshBuilder("OBSTACLE_Segmental arch bridge and voussoirs", collections["quay"], [])
    deck = MeshBuilder("WALK_Crowned bridge deck", collections["ground"], [])
    trim = MeshBuilder("VISUAL_Bridge coping, lamps, and stone joints", collections["details"], [])

    # One continuous extruded profile gives the arch a clear void and solid spandrels.
    profile = []
    for index in range(25):
        x = -5.5 + index * (11.0 / 24.0)
        profile.append((x, bridge_deck_height(x), 0.0))
    for index in range(25):
        x = 4.5 - index * (9.0 / 24.0)
        profile.append((x, arch_intrados(x), 0.0))
    masonry.prism([(x, y, -1.42) for x, y, _ in profile], (0.0, 0.0, 2.84), MAT["river_stone"])

    # Alternating wedge blocks emphasize the masonry ring on both bridge cheeks.
    wedge_count = 20
    angle_pad = 0.010
    for segment in range(wedge_count):
        a0 = pi * segment / wedge_count + angle_pad
        a1 = pi * (segment + 1) / wedge_count - angle_pad
        inner = [
            (4.5 * cos(a0), 0.35 + 1.2 * sin(a0)),
            (4.5 * cos(a1), 0.35 + 1.2 * sin(a1)),
        ]
        outer = [
            (4.88 * cos(a1), 0.35 + 1.52 * sin(a1)),
            (4.88 * cos(a0), 0.35 + 1.52 * sin(a0)),
        ]
        wedge = inner + outer
        material = RNG.choice((MAT["limestone"], MAT["river_stone_light"], MAT["river_stone"]))
        masonry.prism([(x, y, -1.55) for x, y in wedge], (0.0, 0.0, 3.10), material)

    # Deep springers and cutwater-like shoulders seat the arch in both banks.
    for x, side in ((-4.46, -1), (4.46, 1)):
        masonry.box((x, 0.85, 0.0), (0.82, 1.15, 3.02), MAT["river_stone"])
        for zside in (-1.0, 1.0):
            masonry.box((x, 1.45, zside), (0.90, 0.16, 0.75), MAT["limestone_light"])

    # The shallow deck ramp meets the two bank levels without a vertical lip.
    add_sloped_bridge_slab(deck, -5.5, 5.5, -1.55, 1.55, 0.22)

    deck_rng = Random(211028)
    x = -5.26
    row = 0
    while x < 5.3:
        z = -1.34 + (row % 2) * 0.21
        while z < 1.34:
            y = bridge_deck_height(x)
            deck.box((x + deck_rng.uniform(-0.025, 0.025), y + 0.075, z),
                     (0.48 * deck_rng.uniform(0.87, 1.02), 0.12,
                      0.41 * deck_rng.uniform(0.88, 1.02)),
                     deck_rng.choice((MAT["limestone"], MAT["limestone_light"],
                                      MAT["river_stone_light"])))
            z += 0.44
        x += 0.48
        row += 1

    # Low parapets protect the bridge edges and keep the centerline clear.
    for zside in (-1, 1):
        z = zside * 1.57
        x = -5.12
        while x < 5.2:
            length = min(0.80, 5.2 - x)
            mid_x = x + length * 0.5
            base_y = bridge_deck_height(mid_x)
            masonry.box((mid_x, base_y + 0.34, z), (length - 0.035, 0.68, 0.24),
                        RNG.choice((MAT["river_stone"], MAT["limestone"], MAT["river_stone_light"])))
            trim.box((mid_x, base_y + 0.74, z), (length + 0.05, 0.12, 0.38),
                     RNG.choice((MAT["limestone_light"], MAT["limestone"])))
            if abs((mid_x + 5.12) % 2.4) < 0.5:
                masonry.box((mid_x, base_y + 0.94, z), (0.33, 0.40, 0.44), MAT["limestone_light"])
            x += 0.80

    # Chiselled joints, shallow drainage slots, and the two warm bridge lanterns.
    for x in (-4.7, -3.3, -1.9, -0.5, 0.9, 2.3, 3.7, 4.7):
        for zside in (-1, 1):
            trim.box((x, bridge_deck_height(x) - 0.11, zside * 1.425),
                     (0.035, 0.46, 0.014), MAT["mortar"])
    for x in (-5.0, 5.0):
        for z in (-1.92, 1.92):
            add_lantern(trim, x, bridge_deck_height(x) + 0.39, z, 0.72)

    masonry.create()
    deck.create()
    trim.create()


def add_lantern(builder, x, y, z, height):
    builder.beam((x, y - height * 0.5, z), (x, y + height * 0.5, z), 0.085, 0.085, MAT["iron"])
    builder.box((x, y + height * 0.20, z), (0.28, 0.075, 0.28), MAT["iron"])
    builder.ellipsoid((x, y + height * 0.22, z), (0.19, 0.27, 0.19), MAT["warm_glow"], 10, 6)
    builder.box((x, y + height * 0.41, z), (0.32, 0.075, 0.32), MAT["iron"])
    builder.box((x, y + height * 0.52, z), (0.20, 0.14, 0.20), MAT["brass"])


BUILDINGS = (
    {
        "id": "inn", "center": (-12.0, WEST_FLOOR, -5.0), "size": (8.0, 8.0),
        "door": "+x", "wall": "plaster_cream", "plinth": "river_stone",
        "roof": ("roof_terra", "roof_terra_light", "roof_terra_dark", "roof_moss"),
        "front_trim": "timber_dark", "style": "inn",
    },
    {
        "id": "bathhouse", "center": (12.0, EAST_FLOOR, 8.0), "size": (8.0, 8.0),
        "door": "-x", "wall": "plaster_sage", "plinth": "river_stone",
        "roof": ("roof_slate", "roof_slate_light", "roof_slate", "roof_moss"),
        "front_trim": "timber_dark", "style": "bath",
    },
    {
        "id": "riverside_home", "center": (13.0, EAST_FLOOR, -10.0), "size": (7.0, 7.0),
        "door": "-x", "wall": "plaster_rose", "plinth": "limestone_shade",
        "roof": ("roof_terra", "roof_terra_light", "roof_terra_dark", "roof_moss"),
        "front_trim": "timber", "style": "home",
    },
)


def building_wall(builder, building, side, openings, wall_bottom, wall_top, material):
    cx, floor, cz = building["center"]
    sx, sz = building["size"]
    if side in ("+x", "-x"):
        axis_min, axis_max = cz - sz * 0.5, cz + sz * 0.5
        plane_x = cx + (sx * 0.5 if side == "+x" else -sx * 0.5)
        thickness = 0.36
        orientation = "x"
    else:
        axis_min, axis_max = cx - sx * 0.5, cx + sx * 0.5
        plane_z = cz + (sz * 0.5 if side == "+z" else -sz * 0.5)
        thickness = 0.36
        orientation = "z"

    cuts = [(max(axis_min, lo), min(axis_max, hi), max(wall_bottom, y0), min(wall_top, y1))
            for lo, hi, y0, y1 in openings]
    axis_values = {axis_min, axis_max}
    height_values = {wall_bottom, wall_top}
    for lo, hi, y0, y1 in cuts:
        axis_values.update((lo, hi))
        height_values.update((y0, y1))
    axis_values = sorted(axis_values)
    height_values = sorted(height_values)
    for axis_index in range(len(axis_values) - 1):
        a0, a1 = axis_values[axis_index:axis_index + 2]
        if a1 - a0 < 0.03:
            continue
        along = (a0 + a1) * 0.5
        for height_index in range(len(height_values) - 1):
            y0, y1 = height_values[height_index:height_index + 2]
            if y1 - y0 < 0.025:
                continue
            ymid = (y0 + y1) * 0.5
            is_open = any(lo < along < hi and low < ymid < high for lo, hi, low, high in cuts)
            if is_open:
                continue
            if orientation == "x":
                builder.box((plane_x, (y0 + y1) * 0.5, along),
                            (thickness, y1 - y0, a1 - a0), material)
            else:
                builder.box((along, (y0 + y1) * 0.5, plane_z),
                            (a1 - a0, y1 - y0, thickness), material)


def add_window_details(builder, building, side, along, y, width, height, tint):
    cx, floor, cz = building["center"]
    sx, sz = building["size"]
    is_x_wall = side in ("+x", "-x")
    wall_plane = cx + (sx * 0.5 if side == "+x" else -sx * 0.5) if is_x_wall else \
        cz + (sz * 0.5 if side == "+z" else -sz * 0.5)
    if is_x_wall:
        outward = 1.0 if side == "+x" else -1.0
        pane_center = (wall_plane + outward * 0.205, y + height * 0.5, along)
        pane_size = (0.045, height * 0.88, width * 0.86)
        frame_depth_axis = "x"
    else:
        outward = 1.0 if side == "+z" else -1.0
        pane_center = (along, y + height * 0.5, wall_plane + outward * 0.205)
        pane_size = (width * 0.86, height * 0.88, 0.045)
        frame_depth_axis = "z"
    builder.box(pane_center, pane_size, tint)
    frame = MAT["timber_dark"]
    if frame_depth_axis == "x":
        for axis in (along - width * 0.5, along + width * 0.5):
            builder.box((wall_plane + outward * 0.235, y + height * 0.5, axis),
                        (0.12, height + 0.16, 0.13), frame)
        builder.box((wall_plane + outward * 0.235, y + height + 0.045, along),
                    (0.12, 0.13, width + 0.15), frame)
        builder.box((wall_plane + outward * 0.26, y - 0.02, along),
                    (0.30, 0.13, width + 0.28), MAT["limestone_light"])
        builder.beam((wall_plane + outward * 0.27, y + 0.10, along),
                     (wall_plane + outward * 0.27, y + height - 0.06, along),
                     0.035, 0.035, MAT["timber"])
    else:
        for axis in (along - width * 0.5, along + width * 0.5):
            builder.box((axis, y + height * 0.5, wall_plane + outward * 0.235),
                        (0.13, height + 0.16, 0.12), frame)
        builder.box((along, y + height + 0.045, wall_plane + outward * 0.235),
                    (width + 0.15, 0.13, 0.12), frame)
        builder.box((along, y - 0.02, wall_plane + outward * 0.26),
                    (width + 0.28, 0.13, 0.30), MAT["limestone_light"])
        builder.beam((along, y + 0.10, wall_plane + outward * 0.27),
                     (along, y + height - 0.06, wall_plane + outward * 0.27),
                     0.035, 0.035, MAT["timber"])


def roof_and_frame(builder, building):
    cx, floor, cz = building["center"]
    sx, sz = building["size"]
    style = building["style"]
    eave = floor + 3.08
    rise = 1.82 if style == "bath" else 2.05
    ridge = eave + rise
    half_span = sz * 0.5 + 0.38
    slope_angle = atan2(rise, half_span)
    slope_length = sqrt(half_span * half_span + rise * rise)
    overhang_x = 0.45
    trim = MAT[building["front_trim"]]
    roof_mats = tuple(MAT[key] for key in building["roof"])

    # Eaves, rafters, and gable braces are exposed beneath the individual tiles.
    for x in (cx - sx * 0.5 - overhang_x, cx + sx * 0.5 + overhang_x):
        builder.beam((x, eave, cz - sz * 0.5 - 0.22),
                     (x, ridge, cz), 0.16, 0.15, trim)
        builder.beam((x, eave, cz + sz * 0.5 + 0.22),
                     (x, ridge, cz), 0.16, 0.15, trim)
    for side in (-1, 1):
        z = cz + side * (sz * 0.5 + 0.22)
        builder.beam((cx - sx * 0.5 - overhang_x, eave, z),
                     (cx + sx * 0.5 + overhang_x, eave, z), 0.17, 0.14, trim)

    for rafter in range(7):
        x = cx - sx * 0.42 + rafter * sx * 0.14
        for side in (-1, 1):
            builder.beam((x, eave + 0.10, cz + side * (sz * 0.5 - 0.18)),
                         (x, ridge - 0.05, cz), 0.11, 0.10, MAT["timber"])

    # Thin backing boards prevent a tiled roof from reading as a flat floating sheet.
    for side in (-1, 1):
        builder.box((cx, (eave + ridge) * 0.5, cz + side * half_span * 0.5),
                    (sx + 2 * overhang_x, 0.11, slope_length), roof_mats[0],
                    rx=side * slope_angle)

    tile_step_x = 0.58
    tile_step_slope = 0.38
    x_start = cx - sx * 0.5 - overhang_x + 0.30
    x_end = cx + sx * 0.5 + overhang_x
    tile_row = 0
    distance = 0.20
    while distance < slope_length + 0.08:
        x = x_start + (tile_row % 2) * tile_step_x * 0.5
        while x < x_end:
            for roof_side in (-1, 1):
                y = ridge - distance * sin(slope_angle) + 0.025
                z = cz + roof_side * distance * cos(slope_angle)
                tile_material = RNG.choice(roof_mats)
                tile_width = RNG.uniform(0.48, 0.57)
                tile_depth = RNG.uniform(0.48, 0.56)
                builder.box((x, y, z), (tile_width, 0.085, tile_depth), tile_material,
                            rx=roof_side * slope_angle)
            x += tile_step_x
        distance += tile_step_slope
        tile_row += 1

    ridge_x = cx - sx * 0.5 - overhang_x
    while ridge_x < cx + sx * 0.5 + overhang_x:
        builder.box((ridge_x, ridge + 0.10, cz), (0.55, 0.19, 0.26), roof_mats[1])
        ridge_x += 0.50

    # Gable timber makes the entrance face legible from the bridge.
    for side in (-1, 1):
        face_x = cx + side * (sx * 0.5 + 0.26)
        builder.beam((face_x, eave, cz - sz * 0.5 + 0.10),
                     (face_x, ridge, cz), 0.22, 0.16, trim)
        builder.beam((face_x, eave, cz + sz * 0.5 - 0.10),
                     (face_x, ridge, cz), 0.22, 0.16, trim)
        builder.beam((face_x, eave + 0.30, cz - sz * 0.34),
                     (face_x, ridge - 0.28, cz + sz * 0.31), 0.19, 0.14, MAT["timber_dark"])
        builder.beam((face_x, eave + 0.30, cz + sz * 0.34),
                     (face_x, ridge - 0.28, cz - sz * 0.31), 0.19, 0.14, MAT["timber_dark"])
        builder.beam((face_x, eave + 0.16, cz), (face_x, ridge - 0.18, cz),
                     0.17, 0.13, trim)

        # Strong diagonal braces fill the two solid bays beside the centered door.
        y0, y1 = floor + 0.48, eave - 0.28
        for bay in (-1, 1):
            z0 = cz + bay * (sz * 0.5 - 0.34)
            z1 = cz + bay * 1.22
            builder.beam((face_x, y0, z0), (face_x, y1, z1), 0.20, 0.15, trim)
            builder.beam((face_x, y0, z1), (face_x, y1, z0), 0.20, 0.15, trim)

    # The long window walls get a readable post-and-cross-brace rhythm as well.
    for side in (-1, 1):
        face_z = cz + side * (sz * 0.5 + 0.26)
        for xoff in (-sx * 0.5 + 0.24, -2.82, -1.0, 0.0, 1.0, 2.82, sx * 0.5 - 0.24):
            builder.beam((cx + xoff, floor + 0.40, face_z),
                         (cx + xoff, eave - 0.08, face_z), 0.18, 0.14, trim)
        for y in (floor + 0.57, floor + 2.50):
            builder.beam((cx - sx * 0.5 + 0.20, y, face_z),
                         (cx + sx * 0.5 - 0.20, y, face_z), 0.16, 0.12, MAT["timber"])
        builder.beam((cx - 1.14, floor + 0.55, face_z),
                     (cx + 1.14, eave - 0.34, face_z), 0.18, 0.14, MAT["timber_dark"])
        builder.beam((cx + 1.14, floor + 0.55, face_z),
                     (cx - 1.14, eave - 0.34, face_z), 0.18, 0.14, MAT["timber_dark"])

    # Modest capped chimney off the ridge, with a soot-dark recessed flue.
    chimney_x = cx - sx * 0.23
    chimney_z = cz + sz * 0.18
    chimney_base = ridge - 0.20
    builder.box((chimney_x, chimney_base + 0.57, chimney_z), (0.62, 1.25, 0.64), MAT["river_stone"])
    builder.box((chimney_x, chimney_base + 1.19, chimney_z), (0.78, 0.16, 0.78), MAT["limestone_light"])
    builder.box((chimney_x, chimney_base + 1.29, chimney_z), (0.43, 0.045, 0.43), MAT["mortar"])


def add_door_surround(builder, building):
    cx, floor, cz = building["center"]
    sx, _ = building["size"]
    side = building["door"]
    x = cx + (sx * 0.5 + 0.22) * (1 if side == "+x" else -1)
    outer = 1 if side == "+x" else -1
    width, height = 1.8, 2.3
    for z in (cz - width * 0.5 - 0.11, cz + width * 0.5 + 0.11):
        builder.box((x, floor + height * 0.5, z), (0.18, height, 0.18), MAT["limestone_light"])
        builder.box((x + outer * 0.10, floor + height * 0.5, z),
                    (0.10, height - 0.08, 0.055), MAT["timber_dark"])
    builder.box((x, floor + height + 0.13, cz), (0.27, 0.22, width + 0.52), MAT["limestone_light"])
    builder.box((x + outer * 0.04, floor + 0.035, cz), (0.45, 0.07, width + 0.10), MAT["river_stone_light"])
    # A hanging wooden sign uses a simple bowl-and-steam emblem without text.
    if building["style"] == "inn":
        sign_x = x + outer * 0.45
        sign_z = cz - width * 0.5 - 0.72
        builder.beam((x + outer * 0.10, floor + 2.70, sign_z),
                     (sign_x, floor + 2.70, sign_z), 0.08, 0.08, MAT["iron"])
        builder.box((sign_x, floor + 2.43, sign_z), (0.12, 0.48, 0.86), MAT["timber_dark"])
        builder.box((sign_x + outer * 0.08, floor + 2.40, sign_z), (0.06, 0.25, 0.46), MAT["roof_terra_light"])
        builder.ellipsoid((sign_x + outer * 0.12, floor + 2.57, sign_z), (0.06, 0.11, 0.26), MAT["warm_glow"], 8, 5)


def add_interior(builder, furniture, floor_builder, building):
    cx, floor, cz = building["center"]
    sx, sz = building["size"]
    style = building["style"]

    # A warm plank floor sits above the physical walk surface and remains clear
    # along the full 1.8 m entry opening and its central 2.2 m aisle.
    floor_builder.box((cx, floor + 0.09, cz), (sx - 0.46, 0.10, sz - 0.46), MAT["wood_floor"])
    x = cx - sx * 0.5 + 0.38
    while x < cx + sx * 0.5 - 0.25:
        floor_builder.box((x, floor + 0.151, cz), (0.035, 0.012, sz - 0.52), MAT["timber_dark"])
        x += 0.42

    # A central ceiling beam and small wall lights make the rooms read warmly
    # through the open doorway, without placing props in the entry sightline.
    for xoff in (-1.6, 1.6):
        builder.beam((cx + xoff, floor + 2.64, cz - sz * 0.34),
                     (cx + xoff, floor + 2.64, cz + sz * 0.34),
                     0.12, 0.11, MAT["timber"])
    for side in ("+z", "-z"):
        wall_z = cz + (sz * 0.5 - 0.25) * (1 if side == "+z" else -1)
        add_lantern(builder, cx - 1.35, floor + 2.34, wall_z, 0.48)

    if style == "inn":
        # Bar, hearth, and two sleeping alcoves sit to the north/south sides of the aisle.
        furniture.box((cx - 2.65, floor + 0.58, cz - 2.65), (1.28, 1.12, 2.10), MAT["timber"])
        furniture.box((cx - 2.65, floor + 1.18, cz - 2.65), (1.38, 0.12, 2.20), MAT["timber_light"])
        furniture.box((cx + 1.90, floor + 0.28, cz + 2.65), (1.60, 0.48, 1.20), MAT["timber_dark"])
        furniture.box((cx + 1.90, floor + 0.57, cz + 2.65), (1.48, 0.12, 1.08), MAT["linen"])
        furniture.box((cx - 2.45, floor + 0.34, cz + 2.62), (1.60, 0.66, 1.05), MAT["timber"])
        furniture.box((cx - 2.45, floor + 0.70, cz + 2.62), (1.46, 0.12, 0.92), MAT["linen"])
        furniture.box((cx + 2.55, floor + 0.72, cz - 2.62), (0.56, 1.44, 0.66), MAT["river_stone"])
        furniture.box((cx + 2.55, floor + 1.46, cz - 2.62), (0.70, 0.12, 0.80), MAT["limestone_light"])
        furniture.ellipsoid((cx + 2.55, floor + 1.34, cz - 2.62), (0.38, 0.32, 0.38), MAT["warm_glow"], 10, 6)
        add_barrel(furniture, (cx - 0.95, floor + 0.10, cz - 2.85), 0.52, 0.92)
    elif style == "bath":
        # Long benches and a low warm wash basin frame an uncluttered center aisle.
        for side in (-1, 1):
            z = cz + side * 2.72
            furniture.box((cx + 1.20, floor + 0.37, z), (4.55, 0.62, 0.70), MAT["timber"])
            furniture.box((cx + 1.20, floor + 0.70, z), (4.48, 0.10, 0.64), MAT["timber_light"])
            for xoff in (-0.65, 0.65, 1.95, 3.10):
                furniture.box((cx + xoff, floor + 0.16, z), (0.12, 0.36, 0.12), MAT["timber_dark"])
        furniture.box((cx + 2.55, floor + 0.33, cz), (1.05, 0.56, 1.10), MAT["river_stone"])
        furniture.box((cx + 2.55, floor + 0.63, cz), (0.88, 0.08, 0.93), MAT["warm_glow"])
        furniture.box((cx + 3.10, floor + 1.10, cz - 2.10), (0.34, 1.05, 0.38), MAT["timber"])
        furniture.box((cx + 3.10, floor + 1.66, cz - 2.10), (0.60, 0.12, 0.64), MAT["linen"])
    else:
        # Hearth and bed occupy the far half of the cottage, leaving the doorway axis open.
        furniture.box((cx + 2.45, floor + 0.48, cz + 2.42), (1.18, 0.96, 0.82), MAT["river_stone"])
        furniture.box((cx + 2.45, floor + 1.02, cz + 2.42), (1.28, 0.13, 0.90), MAT["limestone_light"])
        furniture.ellipsoid((cx + 2.45, floor + 1.18, cz + 2.42), (0.38, 0.36, 0.36), MAT["warm_glow"], 10, 6)
        furniture.box((cx + 1.75, floor + 0.29, cz - 2.40), (1.76, 0.50, 1.42), MAT["timber_dark"])
        furniture.box((cx + 1.75, floor + 0.57, cz - 2.40), (1.64, 0.11, 1.30), MAT["linen"])
        furniture.box((cx + 2.55, floor + 0.91, cz - 2.40), (0.60, 0.53, 1.32), MAT["timber"])
        furniture.box((cx + 0.55, floor + 0.44, cz + 2.52), (1.02, 0.12, 0.86), MAT["timber_light"])
        for xoff in (0.18, 0.92):
            for zoff in (2.18, 2.86):
                furniture.box((cx + xoff, floor + 0.22, cz + zoff), (0.11, 0.42, 0.11), MAT["timber_dark"])


def add_barrel(builder, center, radius, height):
    cx, y0, cz = center
    profile = ((0.0, 0.82), (0.12, 0.97), (0.40, 1.08), (0.70, 1.02), (0.94, 0.87), (1.0, 0.84))
    segments = 12
    vertices = []
    for fraction, scale in profile:
        y = y0 + fraction * height
        ring_radius = radius * scale
        for index in range(segments):
            angle = tau * index / segments
            vertices.append((cx + ring_radius * cos(angle), y, cz + ring_radius * sin(angle)))
    faces = []
    for ring in range(len(profile) - 1):
        for index in range(segments):
            a = ring * segments + index
            b = ring * segments + (index + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    builder.add_mesh(vertices, faces, MAT["basket"])
    for fraction in (0.16, 0.82):
        builder.beam((cx - radius * 0.96, y0 + fraction * height, cz),
                     (cx + radius * 0.96, y0 + fraction * height, cz),
                     0.055, 0.055, MAT["iron"])


def build_buildings(collections):
    shells = MeshBuilder("OBSTACLE_Inn bathhouse and home shells", collections["architecture"], [])
    masonry = MeshBuilder("VISUAL_Cut stone plinths and door surrounds", collections["details"], [])
    framing = MeshBuilder("VISUAL_Timber framing, shutters, and roof tiles", collections["architecture"], [])
    glazing = MeshBuilder("VISUAL_Warm windows and interior lanterns", collections["interior"], [])
    walk_floors = MeshBuilder("WALK_Interior ground floors", collections["ground"], [])
    finish_floors = MeshBuilder("FLOOR_Visible interior boards", collections["interior"], [])
    furniture = MeshBuilder("SOLID_Interior furnishings", collections["interior"], [])

    for building in BUILDINGS:
        build_one_building(shells, masonry, framing, glazing, walk_floors,
                           finish_floors, furniture, building)

    shells.create()
    masonry.create()
    framing.create()
    glazing.create()
    walk_floors.create()
    finish_floors.create()
    furniture.create()


def build_one_building(shells, masonry, framing, glazing, walk_floors,
                       finish_floors, furniture, building):
    cx, floor, cz = building["center"]
    sx, sz = building["size"]
    xmin, xmax = cx - sx * 0.5, cx + sx * 0.5
    zmin, zmax = cz - sz * 0.5, cz + sz * 0.5
    eave = floor + 3.08
    door_width, door_height = 1.8, 2.3
    front = building["door"]

    # Continuous walkable floor, bounded by true wall openings.
    walk_floors.box((cx, floor + 0.04, cz), (sx - 0.32, 0.20, sz - 0.32), MAT["limestone"])
    base = building["plinth"]
    for side in ("+x", "-x", "+z", "-z"):
        is_front = side == front
        if side in ("+x", "-x"):
            axis_min, axis_max = zmin, zmax
            door_cut = [(cz - door_width * 0.5, cz + door_width * 0.5,
                         floor, floor + door_height)] if is_front else []
            building_wall(shells, building, side, door_cut, floor + 0.25, eave,
                          MAT[building["wall"]])
            side_x = cx + (sx * 0.5 + 0.005) * (1 if side == "+x" else -1)
            # Lower stone course follows the entire facade except across the door.
            wall_sections = [(axis_min, axis_max)]
            if is_front:
                wall_sections = [(axis_min, cz - door_width * 0.5),
                                 (cz + door_width * 0.5, axis_max)]
            for a0, a1 in wall_sections:
                if a1 > a0:
                    masonry.box((side_x, floor + 0.155, (a0 + a1) * 0.5),
                                (0.58, 0.31, a1 - a0), base)
                    masonry.box((side_x, floor + 0.36, (a0 + a1) * 0.5),
                                (0.61, 0.10, a1 - a0), MAT["limestone_light"])
        else:
            windows = []
            for offset in (-sx * 0.25, sx * 0.25):
                windows.append((cx + offset - 0.63, cx + offset + 0.63,
                                floor + 1.25, floor + 2.35))
            building_wall(shells, building, side, windows, floor + 0.25, eave,
                          MAT[building["wall"]])
            side_z = cz + (sz * 0.5 + 0.005) * (1 if side == "+z" else -1)
            masonry.box((cx, floor + 0.155, side_z), (sx, 0.31, 0.58), base)
            masonry.box((cx, floor + 0.36, side_z), (sx, 0.10, 0.61), MAT["limestone_light"])

    # Gable triangles close the front and back above the eaves, leaving the door clear.
    peak = eave + (1.82 if building["style"] == "bath" else 2.05)
    for side in ("+x", "-x"):
        wall_x = cx + (sx * 0.5 - 0.18) * (1 if side == "+x" else -1)
        triangle = [(wall_x, eave, zmin + 0.18), (wall_x, eave, zmax - 0.18),
                    (wall_x, peak - 0.08, cz)]
        shells.prism(triangle, ((0.36 if side == "+x" else -0.36), 0.0, 0.0),
                     MAT[building["wall"]])

    # Repeated dressed-stone quoins and timber plates break up long flat walls.
    for x in (xmin + 0.10, xmax - 0.10):
        for z in (zmin + 0.10, zmax - 0.10):
            for level in range(5):
                y = floor + 0.52 + level * 0.48
                masonry.box((x, y, z), (0.52, 0.24, 0.52),
                            MAT["limestone_light"] if level % 2 else base)
    for y in (floor + 1.08, eave - 0.10):
        framing.box((cx, y, zmin - 0.22), (sx + 0.34, 0.17, 0.14), MAT["timber"])
        framing.box((cx, y, zmax + 0.22), (sx + 0.34, 0.17, 0.14), MAT["timber"])
        framing.box((xmin - 0.22, y, cz), (0.14, 0.17, sz + 0.34), MAT["timber"])
        framing.box((xmax + 0.22, y, cz), (0.14, 0.17, sz + 0.34), MAT["timber"])

    # Real wall cutouts, inset panes, carved sills, and outward-opening shutters.
    for side in ("+z", "-z"):
        for offset in (-sx * 0.25, sx * 0.25):
            along = cx + offset
            tint = MAT["warm_glow"] if building["style"] != "bath" else MAT["cool_glass"]
            add_window_details(glazing, building, side, along,
                               floor + 1.25, 1.26, 1.10, tint)
            outward = 1 if side == "+z" else -1
            wall_z = cz + (sz * 0.5 + 0.27) * outward
            for shutter_side in (-1, 1):
                framing.box((along + shutter_side * 0.83, floor + 1.88, wall_z),
                            (0.42, 0.92, 0.12), MAT["timber"],
                            ry=shutter_side * 0.11)
                framing.box((along + shutter_side * 0.83, floor + 1.88, wall_z + outward * 0.07),
                            (0.36, 0.045, 0.045), MAT["timber_light"],
                            ry=shutter_side * 0.11)

    # The opening is 1.8 m wide by 2.3 m high. No leaf or prop occupies it.
    add_door_surround(masonry, building)
    roof_and_frame(framing, building)
    add_interior(glazing, furniture, finish_floors, building)


def build_stairs(collections):
    treads = MeshBuilder("WALK_East bank switchback stair flight", collections["ground"], [])
    retaining = MeshBuilder("OBSTACLE_Stair cheek walls and landing returns", collections["quay"], [])
    detail = MeshBuilder("VISUAL_Stair nosings and handrail sockets", collections["details"], [])

    stair_x0, stair_x1 = STAIR_X0, STAIR_X1
    center_x = (stair_x0 + stair_x1) * 0.5
    top_landing_z0, top_landing_z1 = 6.75, 7.35
    treads.box((center_x, EAST_FLOOR - 0.12, (top_landing_z0 + top_landing_z1) * 0.5),
               (stair_x1 - stair_x0, 0.24, top_landing_z1 - top_landing_z0), MAT["limestone"])

    count = 12
    start_z, end_z = top_landing_z1, 12.97
    rise = (EAST_FLOOR - LOW_QUAY_FLOOR) / count
    run = (end_z - start_z) / count
    for index in range(count):
        top = EAST_FLOOR - (index + 1) * rise
        depth = run + 0.055
        z = start_z + (index + 0.5) * run
        treads.box((center_x, top - 0.16, z),
                   (stair_x1 - stair_x0, 0.32, depth),
                   RNG.choice((MAT["limestone"], MAT["limestone_light"], MAT["river_stone_light"])))
        detail.box((center_x, top + 0.015, z - run * 0.36),
                   (stair_x1 - stair_x0 + 0.025, 0.035, 0.075), MAT["limestone_light"])

    # The lower tread opens directly onto the paved quay at x=6.5, z=13.
    # Stepped low cheeks follow the flight without narrowing its 1.7 m clear width.
    for side_x in (stair_x0 - 0.09, stair_x1 + 0.09):
        for index in range(count):
            top = EAST_FLOOR - index * rise + 0.18
            z = start_z + (index + 0.5) * run
            retaining.box((side_x, top - 0.39, z), (0.18, 0.78, run + 0.07),
                          RNG.choice((MAT["river_stone"], MAT["limestone_shade"])))
            retaining.box((side_x, top + 0.025, z), (0.27, 0.09, run + 0.10), MAT["limestone_light"])
    retaining.box((center_x, EAST_FLOOR - 0.23, top_landing_z0),
                  (stair_x1 - stair_x0 + 0.25, 0.46, 0.16), MAT["river_stone"])

    treads.create()
    retaining.create()
    detail.create()


def add_town_fixtures(collections):
    obstacle = MeshBuilder("HIT_Bridge approach bollards", collections["details"], [])
    visual = MeshBuilder("VISUAL_Benches, moorings, and water-edge planting", collections["details"], [])

    # Benches sit beside the west lane and outside all doorway sightlines.
    for x, z, facing in ((-9.2, 3.2, 1), (-9.2, -17.5, 1), (9.2, 18.0, -1)):
        visual.box((x, WEST_FLOOR + 0.42 if x < 0 else EAST_FLOOR + 0.42, z),
                   (0.58, 0.12, 1.65), MAT["timber"])
        for offset in (-0.56, 0.56):
            visual.box((x, WEST_FLOOR + 0.21 if x < 0 else EAST_FLOOR + 0.21, z + offset),
                       (0.45, 0.42, 0.12), MAT["timber_dark"])
        visual.box((x, WEST_FLOOR + 0.87 if x < 0 else EAST_FLOOR + 0.87, z),
                   (0.14, 0.78, 1.65), MAT["timber"])

    # A few mooring posts and bollards establish the low quay scale.
    for z in (-24.0, -5.0, 3.0, 18.0, 25.0):
        for x, y in ((-5.12, WEST_FLOOR), (5.05, EAST_FLOOR)):
            obstacle.box((x, y + 0.36, z), (0.25, 0.72, 0.25), MAT["river_stone"])
            visual.box((x, y + 0.76, z), (0.34, 0.10, 0.34), MAT["limestone_light"])

    # Short grasses and moss pockets stay at the wall toe, outside the walking lanes.
    for side, edge, top in ((-1, RIVER_WEST, WEST_FLOOR), (1, RIVER_EAST, EAST_FLOOR)):
        for index in range(38):
            z = RNG.uniform(BANK_Z_MIN + 1.0, BANK_Z_MAX - 1.0)
            if side > 0 and 7.0 < z < 13.0:
                top = LOW_QUAY_FLOOR
            else:
                top = WEST_FLOOR if side < 0 else EAST_FLOOR
            x = edge + side * RNG.uniform(0.55, 1.05)
            if side < 0 and -8.0 < x < -6.0 or side > 0 and 6.9 < x < 7.9:
                continue
            size = RNG.uniform(0.12, 0.34)
            visual.ellipsoid((x, top + size * 0.30, z), (size, size * 0.90, size * 0.62),
                             MAT["grass"], segments=7, rings=4)

    obstacle.create()
    visual.create()


def dress_outlying_plots(collections):
    houses = MeshBuilder("OBSTACLE_Terrace cottages and store", collections["architecture"], [])
    details = MeshBuilder("VISUAL_Garden terraces and trim", collections["details"], [])
    leaf_mats = [make_material("Garden " + c, c) for c in ("47573b", "526948", "65754a", "839359")]
    blooms = [make_material("Petals " + c, c) for c in ("c7ae69", "ded0ab", "9f7877")]
    plots = (
        (-16.55, WEST_FLOOR, 9.1, 3.9, 4.75, 2.9, 1.97, "plaster_rose", "roof_slate"),
        (-15.45, WEST_FLOOR, -18.3, 4.8, 4.1, 3.45, 2.08, "plaster_sage", "roof_terra_dark"),
        (15.80, EAST_FLOOR, -22.1, 4.2, 4.65, 2.42, 1.68, "plaster_cream", "roof_slate_light"),
    )
    for x, y, z, sx, sz, h, rise, plaster, roof in plots:
        houses.box((x, y + 0.33, z), (sx + 0.20, 0.66, sz + 0.20), MAT["river_stone"])
        houses.box((x, y + h * 0.5, z), (sx, h, sz), MAT[plaster])
        pitch = atan2(rise, sz * 0.5)
        eave, ridge = y + h, y + h + rise
        profile = [(x - sx * 0.5, eave, z - sz * 0.5), (x - sx * 0.5, eave, z + sz * 0.5),
                   (x - sx * 0.5, ridge, z)]
        houses.prism(profile, (sx, 0, 0), MAT[plaster])
        angle_span = sqrt((sz * 0.5)**2 + rise**2)
        for side in (-1, 1):
            zz = z + side * sz * 0.25
            houses.box((x, eave + rise * 0.5, zz), (sx + 0.78, 0.15, angle_span + 0.58), MAT[roof], rx=side*pitch)
            for row in range(8):
                along = row * angle_span / 7
                for col in range(int((sx + 0.30) / 0.44)):
                    xx = x - sx*0.5 - 0.06 + col*0.44 + (row % 2)*0.18
                    details.box((xx, ridge - along*sin(pitch) + 0.095, z + side*along*cos(pitch)),
                                (0.415, 0.062, angle_span/7 + 0.12),
                                RNG.choice((MAT[roof], MAT[roof], MAT["roof_moss"])), rx=side*pitch)
            face_z = z + side * (sz * 0.5 + 0.047)
            for xx in (x - sx*0.5 + 0.08, x, x + sx*0.5 - 0.08):
                details.box((xx, y + h*0.53, face_z), (0.18, h*0.94, 0.13), MAT["timber_dark"])
            for bay in (-1, 1):
                xx = x + bay*sx*0.25
                details.box((xx, y + h*0.60, face_z), (0.62, 0.84, 0.15), MAT["timber_dark"])
                details.box((xx, y + h*0.60, face_z + side*0.078), (0.40, 0.61, 0.022), MAT["warm_glow"])
                details.box((xx, y + h*0.60, face_z + side*0.098), (0.04, 0.62, 0.025), MAT["timber_dark"])
        front = x + (sx*0.5 + 0.055) * (-1 if x > 0 else 1)
        details.box((front, y + 1.01, z), (0.13, 1.93, 1.03), MAT["timber_dark"])
        for offset in (-0.37, -0.16, 0.055, 0.26):
            details.box((front, y + 1.07, z + offset), (0.19, 1.81, 0.16), MAT["timber"])
        details.box((x + 0.70, ridge + 0.33, z - sz*0.17), (0.52, 1.10, 0.65), MAT["river_stone"])
        details.box((x + 0.70, ridge + 0.91, z - sz*0.17), (0.67, 0.13, 0.78), MAT["limestone"])

    for x, h, z, width, depth in (
        (-16.8, WEST_FLOOR, 17.4, 4.1, 2.8), (-16.9, WEST_FLOOR, -10.8, 3.8, 2.4),
        (-12.7, WEST_FLOOR, 20.2, 3.2, 1.9), (16.8, EAST_FLOOR, 13.9, 4.4, 2.1),
        (15.7, EAST_FLOOR, -17.4, 3.6, 1.3), (14.9, EAST_FLOOR, 20.0, 4.5, 2.2),
    ):
        details.box((x, h + 0.06, z), (width, 0.15, depth), MAT["soil"])
        for side in (-1, 1):
            details.box((x, h + 0.13, z + side*(depth*0.5 - 0.06)), (width, 0.24, 0.16), MAT["river_stone"])
            details.box((x + side*(width*0.5 - 0.06), h + 0.13, z), (0.17, 0.24, depth), MAT["river_stone"])
        for _ in range(int(width * depth * 9)):
            xx = x + RNG.uniform(-0.44, 0.44) * width
            zz = z + RNG.uniform(-0.42, 0.42) * depth
            span = RNG.uniform(0.14, 0.37)
            details.ellipsoid((xx, h + 0.16, zz), (span, span*0.87, span), RNG.choice(leaf_mats), 7, 4)
            if RNG.random() < 0.27:
                details.ellipsoid((xx + 0.034, h+0.19+span*0.33, zz), (0.065, 0.055, 0.074), RNG.choice(blooms), 6, 3)
    houses.create()
    details.create()


def add_preview_rig(scene, collection):
    camera_data = bpy.data.cameras.new("Town overview camera")
    camera = bpy.data.objects.new("Town overview camera", camera_data)
    collection.objects.link(camera)
    camera.location = g2b((29.0, 22.0, -31.0))
    target = Vector(g2b((0.5, 1.7, -0.8)))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 48.0
    camera_data.lens = 48
    scene.camera = camera

    for name, location, power, size, color in (
        ("Warm key", (10, 23, -8), 2600, 18, (1.0, 0.78, 0.56)),
        ("Cool river fill", (-18, 15, -2), 1800, 15, (0.68, 0.76, 0.91)),
        ("Low sunset rim", (2, 18, 24), 2200, 14, (1.0, 0.61, 0.42)),
    ):
        light_data = bpy.data.lights.new(name, type="AREA")
        light_data.energy = power
        light_data.shape = "DISK"
        light_data.size = size
        light_data.color = color
        light = bpy.data.objects.new(name, light_data)
        collection.objects.link(light)
        light.location = g2b(location)
        light.rotation_euler = (Vector(g2b((0.0, 1.0, 0.0))) - light.location).to_track_quat("-Z", "Y").to_euler()

    world = bpy.data.worlds.new("Etwas evening studio")
    world.use_nodes = True
    background = next(node for node in world.node_tree.nodes if node.type == "BACKGROUND")
    background.inputs[0].default_value = (0.20, 0.22, 0.28, 1.0)
    background.inputs[1].default_value = 0.36
    scene.world = world
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.render.image_settings.file_format = "PNG"
    bpy.context.preferences.filepaths.save_version = 0

    global MAT
    MAT = create_materials()

    root = scene.collection
    collections = {
        "ground": make_collection("01 Ground, floors, and walkable surfaces", root),
        "quay": make_collection("02 Quay, bridge structure, and stairs", root),
        "architecture": make_collection("03 Inn, bathhouse, and riverside home", root),
        "interior": make_collection("04 Warm interiors and furnishings", root),
        "details": make_collection("05 Paving, lamps, and river edge details", root),
        "water": make_collection("06 River water surface", root),
        "studio": make_collection("07 Preview camera and lights", root),
    }

    build_banks(collections)
    build_river(collections["water"])
    build_bridge(collections)
    build_stairs(collections)
    build_buildings(collections)
    add_town_fixtures(collections)
    dress_outlying_plots(collections)
    add_preview_rig(scene, collections["studio"])

    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"

    # Keep the editable source camera-ready and export only scene meshes.
    bpy.ops.object.select_all(action="DESELECT")
    mesh_objects = [obj for obj in scene.objects if obj.type == "MESH"]
    for obj in mesh_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objects[0] if mesh_objects else None

    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.export_scene.gltf(filepath=str(GLB_PATH), export_format="GLB",
                              use_selection=True, export_apply=True)

    print("ETWAS_TOWN_EXPORT", str(GLB_PATH))
    print("FIXTURE_CLEAR_AREAS")
    print("inn entry axis: x=-7.78..-6.15, z=-6.1..-3.9, y=1.5")
    print("bath entry axis: x=7.82..6.85, z=7.0..9.0, y=2.6")
    print("home entry axis: x=9.32..7.9, z=-11.1..-8.9, y=2.6")
    print("bridge deck: center=(0, approx 2.05, 0), span x=-5.5..5.5, width z=3.1 m")
    print(f"east stair: x={STAIR_X0}..{STAIR_X1}, z=7..13, y=2.6 to 0.48")
    print("east lower quay walk: x=4.2..11.5, z=12..16, y=0.48")
    print("preview camera target: godot=(0.5, 1.7, -0.8)")


if __name__ == "__main__":
    build_scene()
