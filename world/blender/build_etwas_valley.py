"""Sculpt the river valley, the climb and the abandoned baths in Blender."""
from math import cos, exp, pi, sin, tau
from pathlib import Path
from random import Random
import sys

import bpy
from mathutils import Vector
from mathutils.noise import noise_vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.dont_write_bytecode = True
from build_etwas import collection, ease, matte, mesh, paint, painted_surface, rock, save, tint_vertices

# XYZ in Godot coordinates. The last knot overlaps the south edge of the spring shelf.
CLIMB = [
    (9, 2.60, -22), (9, 2.60, -26), (19, 4.0, -39), (46, 7.5, -47),
    (71, 11, -38), (88, 14, -50), (77, 18, -67), (42, 21, -65),
    (31, 24, -80), (52, 27, -97), (79, 30, -89), (100, 33.7, -102),
    (100.9, 36.12, -108.8), (101.4, 36.05, -112.8),
]
RUIN_PATH = [(77, 18, -67), (77, 18, -73), (77, 18, -80)]
RNG = Random(31126)


def point(godot):
    x, y, z = godot
    return Vector((x, -z, y))


def rounded_route(knots):
    knots = [point(k) for k in knots]
    sampled = []
    for i, a in enumerate(knots[:-1]):
        b = knots[i + 1]
        back = knots[max(i - 1, 0)]
        ahead = knots[min(i + 2, len(knots) - 1)]
        for j in range(8):
            t = j / 8
            # Cubic with tangent handles, gently easing the switchback corners.
            ca = a + (b - back) * 0.12
            cb = b - (ahead - a) * 0.12
            sampled.append((1-t)**3*a + 3*(1-t)**2*t*ca + 3*(1-t)*t*t*cb + t**3*b)
    return sampled + [knots[-1]]


TRAIL = rounded_route(CLIMB)
RUIN_WALK = [point(k) for k in RUIN_PATH]
TRAIL_SEGMENTS = []
for a, b in list(zip(TRAIL, TRAIL[1:])) + list(zip(RUIN_WALK, RUIN_WALK[1:])):
    dx, dy = b.x - a.x, b.y - a.y
    TRAIL_SEGMENTS.append((a.x, a.y, a.z, dx, dy, b.z - a.z, dx * dx + dy * dy))


def nearest_grade(x, y):
    distance2, grade = float("inf"), 0.0
    for ax, ay, h, dx, dy, dz, length2 in TRAIL_SEGMENTS:
        rx, ry = x - ax, y - ay
        t = max(0.0, min(1.0, (rx * dx + ry * dy) / length2))
        d2 = (rx - t * dx)**2 + (ry - t * dy)**2
        if d2 < distance2:
            distance2, grade = d2, h + t * dz
    return distance2**0.5, grade


def height(x, y, distance, grade):
    n = noise_vector((x * 0.043, y * 0.043, 0.71))[0]
    hill = 15 * exp(-((x - 48) / 39)**2 - ((y - 66) / 63)**2)
    hill += 29 * exp(-((x - 109) / 48)**2 - ((y - 78) / 54)**2)
    hill += 27 * exp(-((x + 36) / 31)**2 - ((y - 54) / 57)**2)
    hill += 17 * exp(-((x + 61) / 31)**2 - ((y + 15) / 46)**2)
    hill += n * 4.8
    bank = 2.58 if x > 0 else 1.48
    bank_blend = ease((abs(x) - 19) / 17) if -29 < y < 30 else ease((abs(x) - 8) / 19)
    floor = bank + (hill - bank) * bank_blend
    # Western flanks of the hill stay above the town. Grade the trail and its shoulders together.
    floor = grade - 0.035 + (floor - grade) * ease((distance - 2.55) / 14)
    ruin_pad = max(abs(x - 77) - 5.5, abs(y - 77) - 5.2)
    floor += (17.94 - floor) * (1 - ease(ruin_pad / 2.7))
    if x > 88 and y > 108:
        floor = min(floor, 36.05)
    return floor


def ground(group):
    # Build a dense, colored terrain near the route. Keep the actual river and town plots open.
    xs = [-80 + i * 0.85 for i in range(251)]
    ys = [-52 + i * 0.85 for i in range(211)]
    vertices, colors, faces = [], [], []
    low, moss, heather = (paint(c) for c in ("364630", "717f50", "918063"))
    exposed = paint("a1937c")
    for y in ys:
        for x in xs:
            distance, grade = nearest_grade(x, y)
            z = height(x, y, distance, grade)
            n = noise_vector((x * 0.095, y * 0.095, 2.6))[2]
            tint = low.lerp(moss, ease(0.50 + n * 1.16))
            tint = tint.lerp(heather, ease((z - 9) / 22) * (0.35 + 0.56 * ease(n + 0.4)))
            tint = tint.lerp(exposed, (1 - ease((distance - 1.35 - 0.16*n) / 0.95)) * ease((y - 23) / 8))
            vertices.append((x, y, z))
            colors.append(tint)
    for j, y in enumerate(ys[:-1]):
        for i, x in enumerate(xs[:-1]):
            if -19.5 < x < 18.3 and -25 < y < 28.8:
                continue
            if abs(x) < 4.55 and y < 62:
                continue
            if x > 89 and y > 113:
                continue
            a = j * len(xs) + i
            faces.append((a, a + 1, a + 1 + len(xs), a + len(xs)))
    terrain = mesh(group, "FLOOR_ValleyHillside", vertices, faces, [painted_surface("Forest floor and dry trail")], smooth=True)
    tint_vertices(terrain, colors)


def ribbon(group, name, route, width, material, height_bias=0):
    vertices, faces = [], []
    for i, center in enumerate(route):
        tangent = route[min(i + 1, len(route) - 1)] - route[max(0, i - 1)]
        side = Vector((-tangent.y, tangent.x, 0)).normalized() * width / 2
        vertices.extend((center + side + Vector((0, 0, height_bias)), center - side + Vector((0, 0, height_bias))))
        if i:
            a = (i - 1) * 2
            faces.append((a, a + 1, a + 3, a + 2))
    return mesh(group, name, vertices, faces, [material])


def block(group, name, center, size, material, bevel=0.025):
    x, y, z = center
    a, b, c = (s * 0.5 for s in size)
    vertices = [(x + a*sx, y + b*sy, z + c*sz) for sx, sy, sz in (
        (-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
        (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    faces = [(3, 2, 1, 0), (0, 1, 5, 4), (1, 2, 6, 5),
             (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]
    obj = mesh(group, name, vertices, faces, [material])
    if bevel:
        modifier = obj.modifiers.new("Worn arris", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
    return obj


def ruined_baths(group, stones):
    old_floor = matte("Water-stained flagstone", "847e70")
    mortar = matte("Deep brown limestone joints", "514e43")
    block(group, "WALK_OldBathFloor", (77, 77.5, 17.89), (8.6, 8.1, 0.24), old_floor)
    for row in range(10):
        for col in range(9):
            x, y = 73.12 + col*0.96, 73.85 + row*0.79
            block(group, "Flagstone", (x, y, 18.015 + RNG.uniform(-0.012, 0.012)),
                  (0.918, 0.745, 0.05), RNG.choice(stones[1:]), 0.028)
    # Remaining side walls and the low rear bath curb. Collision proxies stay simple.
    block(group, "OBSTACLE_WestBathWall", (72.83, 77.5, 19.24), (0.48, 8.0, 2.4), mortar)
    block(group, "OBSTACLE_EastBathWall", (81.17, 77.5, 18.56), (0.48, 8, 1.08), mortar)
    block(group, "OBSTACLE_BathBackWall", (77, 81.55, 18.61), (8.8, 0.58, 1.22), mortar)
    for side, height_limit in ((72.81, 8), (81.18, 4)):
        for course in range(height_limit):
            for span in range(10):
                if course > height_limit - 3 and RNG.random() < 0.30:
                    continue
                block(group, "Quarried wall course", (side, 73.7 + span*0.82 + (course % 2)*0.20, 18.15 + course*0.32),
                      (RNG.uniform(0.51, 0.64), RNG.uniform(0.71, 0.81), 0.32), RNG.choice(stones), 0.063)
    for course in range(4):
        for span in range(11):
            block(group, "Back wall facing", (72.86 + span*0.81 + (course % 2)*0.18, 81.55, 18.13 + course*0.31),
                  (0.79, 0.66, 0.30), RNG.choice(stones), 0.055)
    for x in (75.15, 78.85):
        block(group, "OBSTACLE_PortalPier", (x, 73.64, 19.2), (0.68, 0.74, 2.4), mortar)
        for i in range(6):
            block(group, "Portal pier block", (x, 73.62, 18.22 + i*0.40),
                  (0.73 + 0.10*(i in (0, 5)), 0.84, 0.39), stones[i % len(stones)], 0.05)
    for i in range(13):
        a, b = i*pi/13 + 0.014, (i+1)*pi/13 - 0.014
        verts = [(77 + r*cos(t), y, 20.25 + r*sin(t)) for y in (73.26, 74.02)
                 for r, t in ((1.47, a), (1.93, a), (1.93, b), (1.47, b))]
        mesh(group, "Portal voussoir", verts, [(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],
             [RNG.choice(stones)])
    for x in (76.35, 77.7, 79.05):
        block(group, "Collapsed basin coping", (x, 79.77, 18.22), (1.28, 0.64, 0.43), RNG.choice(stones), 0.09)
    # A dry stone race runs downhill east of the ruined wall.
    for i in range(15):
        y = 77.8 - i*0.56
        z = 18.07 - i*0.038
        block(group, "Dry channel bed", (83.65, y, z), (0.85, 0.59, 0.15), old_floor, 0.035)
        for side in (-1, 1):
            if (i, side) in ((3, 1), (8, -1), (11, -1)):
                continue
            block(group, "Dry channel curb", (83.65 + side*0.53, y, z + 0.16), (0.38, 0.56, 0.35), RNG.choice(stones), 0.059)
    for i in range(32):
        x = RNG.choice((-1, 1)) * RNG.uniform(2.6, 4.2) + 77
        y = RNG.uniform(73.5, 80.6)
        radius = RNG.uniform(0.12, 0.34)
        rock(group, "Rubble at the bath walls", (x, y, 18.035), (radius, radius*0.74, radius*0.58), stones)


def forest(group):
    needles, bark, faces, foliage, tint = [], [], [], [], []
    palette = [paint(c) for c in ("293e37", "344d3d", "435c41", "52664b", "6f7950")]
    dark_bark = matte("Firs | ridged bark", "57463b")
    trunks = []

    def cone(vertices, polygons, x, y, z, radius, top, rotation):
        first = len(vertices)
        for side in range(7):
            a = rotation + side*tau/7
            r = radius * RNG.uniform(0.78, 1.16)
            vertices.append((x + r*cos(a), y + r*sin(a), z + RNG.uniform(-0.11, 0.11)))
        vertices.append((x + 0.16*radius, y - 0.17*radius, z + top))
        polygons.extend((first+i, first+(i+1)%7, first+7) for i in range(7))

    for _ in range(1450):
        x, y = RNG.uniform(-76, 130), RNG.uniform(-48, 114)
        distance, grade = nearest_grade(x, y)
        if distance < 3 or abs(x) < 6 or (-20 < x < 19 and -27 < y < 31):
            continue
        if abs(x-77) < 10 and abs(y-77) < 8 or x > 88 and y > 96:
            continue
        if RNG.random() > 0.54 + 0.37 * cos(x * 0.25 + sin(y * 0.19)):
            continue
        z = height(x, y, distance, grade)
        h = RNG.uniform(2.5, 7.3) * (1.0 - 0.32*ease((z-20)/13))
        r = h*RNG.uniform(0.19, 0.28)
        cone(bark, trunks, x, y, z-0.27, h*0.035, h*0.81, 0)
        base = RNG.choice(palette[:-1])
        for level, scale in enumerate((1.0, 0.84, 0.65, 0.48)):
            cone(needles, foliage, x, y, z + h*(0.23 + level*0.17), r*scale, h*(0.35 + level*0.011), RNG.uniform(0, tau))
            tint.extend([base.lerp(RNG.choice(palette), RNG.uniform(0.04, 0.4)) for _ in range(7)])
            tint.append(base.lerp(palette[-1], 0.32))
    mesh(group, "Firs | trunks", bark, trunks, [dark_bark])
    crowns = mesh(group, "Firs | interlaced boughs", needles, foliage, [painted_surface("Fir needles")])
    tint_vertices(crowns, tint)


def outcrops(group, stones):
    for i in range(96):
        x, y = RNG.uniform(-52, 116), RNG.uniform(-37, 109)
        distance, grade = nearest_grade(x, y)
        if distance < 2.75 or -21 < x < 20 and -30 < y < 32 or abs(x-77) < 9 and abs(y-77) < 8:
            continue
        z = height(x, y, distance, grade)
        r = RNG.uniform(0.5, 3.25)
        if distance < r + 1.9:
            continue
        rock(group, f"HIT_SlopeSchist{i:02}", (x, y, z-0.21), (r, r*0.77, r*0.72), stones, RNG.uniform(0, tau))


def distant_peaks(group):
    layers = [
        (104, -97, 150, 33, ("485652", "6f7861")),
        (141, -86, 178, 55, ("555f68", "899398")),
        (197, -93, 232, 74, ("6a7183", "979eac")),
    ]
    for i, (depth, center, width, amplitude, shades) in enumerate(layers):
        vertices, faces, pigment = [], [], []
        dark, bright = (paint(c) for c in shades)
        for row in range(17):
            t = row / 16
            for col in range(105):
                s = col / 104
                x = center + (s - 0.5) * width
                crest = (0.28 + 0.45 * exp(-((s - 0.35 - i * 0.08) / 0.16)**2)
                         + 0.29 * exp(-((s - 0.62 + i * 0.03) / 0.12)**2))
                detail = noise_vector((x * 0.05, t * 3, i + 0.3))[0]
                silhouette = (crest + 0.17 * detail + 0.08 * cos(s * 59 + i)) * sin(s * pi)**0.32
                h = -2 + amplitude * silhouette * sin(t * pi)**1.32
                vertices.append((x + t * (8 - i * 3), depth + t * (39 + i * 9), h))
                pigment.append(dark.lerp(bright, ease(h / (amplitude * 0.53)) * (0.71 + 0.28 * detail)))
                if row and col:
                    a = row * 105 + col
                    faces.append((a - 106, a - 105, a, a - 1))
        ridge = mesh(group, f"Western watershed {i + 1}", vertices, faces, [painted_surface("Distant forest haze")], smooth=True)
        tint_vertices(ridge, pigment)


def alpine_meadow(group):
    verts, faces, colors = [], [], []
    shades = [paint(c) for c in ("5d6748", "78855b", "b8a57a", "b2a0ac", "d2b37a")]
    for i in range(1350):
        x, y = RNG.uniform(16, 99), RNG.uniform(32, 108)
        distance, grade = nearest_grade(x, y)
        if not 1.55 < distance < 4.05 or (abs(x - 77) < 6 and abs(y - 77) < 6):
            continue
        for _ in range(RNG.randrange(7, 15)):
            px = x + RNG.uniform(-0.33, 0.33)
            py = y + RNG.uniform(-0.33, 0.33)
            pz = height(px, py, distance, grade)
            angle = RNG.uniform(0, tau)
            h = RNG.uniform(0.10, 0.32)
            axis = Vector((cos(angle), sin(angle), 0))
            foot = Vector((px, py, pz - 0.04))
            mid = foot + Vector((0, 0, h * 0.72))
            tip = mid + Vector((axis.y * h * 0.38, -axis.x * h * 0.38, h * 0.33))
            a = len(verts)
            verts.extend((foot - axis * 0.016, foot + axis * 0.016, mid + axis * 0.020, mid - axis * 0.020, tip))
            colors.extend((shades[0], shades[0], shades[1], shades[1], RNG.choice(shades[1:])))
            faces.extend(((a, a + 1, a + 2, a + 3), (a + 3, a + 2, a + 4)))
    meadow = mesh(group, "Trail grasses", verts, faces, [painted_surface("Pale trail grass")])
    tint_vertices(meadow, colors)


def river_reaches(group):
    water = matte("Slate green river", "49706c", 0.23)
    bank_material = painted_surface("Wet shingle and grass")
    wet, bank = paint("4b5652"), paint("718058")
    for name, start, end in (("Upstream", 30.2, 61.9), ("Downstream", -51.8, -27.1)):
        surface, rim, pigment, river_faces, rim_faces = [], [], [], [], []
        for i in range(49):
            t = i / 48
            y = start + t * (end - start)
            reach = ease((y - 32) / 26) if start > 0 else ease((-y - 28) / 22)
            center = sin(y * 0.19 + 0.22) * 0.95 * reach
            width = 4.24 - 2.06 * reach
            bed = 0.014 + 0.85 * reach if start > 0 else 0.011 - 0.15 * reach
            for side in (-1, 1):
                water_x = center + side * width
                outer_x = side * (7.0 + 0.55 * sin(y * 0.33))
                distance, grade = nearest_grade(outer_x, y)
                upper = height(outer_x, y, distance, grade)
                surface.append((water_x, y, bed + 0.013 * sin(y * 2.3 + side)))
                rim += [(water_x - side * 0.16, y, bed - 0.10), (water_x + side * 0.31, y, bed + 0.17),
                        (outer_x, y, upper - 0.009)]
                pigment += [wet, wet.lerp(bank, 0.34 + 0.13 * sin(y * 3.05)), bank]
            if i:
                a = i * 2
                river_faces.append((a - 2, a - 1, a + 1, a))
                for side in range(2):
                    for band in range(2):
                        a = i * 6 + side * 3 + band
                        face = (a - 6, a - 5, a + 1, a)
                        rim_faces.append(face if side else face[::-1])
        mesh(group, "WATER_" + name, surface, river_faces, [water], smooth=True)
        shore = mesh(group, "Gravel bars | " + name, rim, rim_faces, [bank_material], smooth=True)
        tint_vertices(shore, pigment)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    stones = [matte("Old limestone | " + c, c) for c in ("615e56", "726d5f", "898171", "9c917c")]
    ground(collection("Graded hillside and river cut"))
    nav = matte("Walkable grade guide", "c7aa85")
    path = collection("Walkable grade guides")
    ribbon(path, "NAV_MountainTrail", TRAIL, 3.6, nav)
    ribbon(path, "NAV_OldBathSpur", RUIN_WALK, 3.4, nav)
    channel = rounded_route([(77,18,-72), (79,18,-71), (83,18,-72)])
    ribbon(path, "WALK_ChannelApproach", channel, 2.5, nav)
    ruined_baths(collection("Abandoned baths and dry race"), stones)
    forest(collection("Fir stands"))
    outcrops(collection("Exposed strata"), stones)
    distant_peaks(collection("Western watershed"))
    alpine_meadow(collection("Alpine grasses along the trail"))
    river_reaches(collection("Upstream and downstream gravel bars"))
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                viewport = area.spaces.active
                viewport.clip_end = 380
                viewport.shading.color_type = "MATERIAL"
                viewport.region_3d.view_location = point((57, 13, -52))
                viewport.region_3d.view_rotation = Vector((0.7, 1, -1.06)).to_track_quat("-Z", "Y")
                viewport.region_3d.view_distance = 100
    save("etwas-valley", "valley")


if __name__ == "__main__":
    main()
