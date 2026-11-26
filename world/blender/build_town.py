# Building shells share layout window dimensions with world.gd collision and sight.
# Writes world/assets/buildings/<id>.glb for the town and the six outskirts buildings.
# export_buildings.py skips these ids so a greybox export will not put the boxes back.
# blender -b --factory-startup --python world/blender/build_town.py

import json
import sys
import traceback
from pathlib import Path

import bmesh
import bpy
import mathutils

ROOT = Path(__file__).resolve().parents[1]
LAYOUT_PATH = ROOT / "data" / "layout.json"
OUT_DIR = ROOT / "assets" / "buildings"
TOWN = (
    "guild_hall", "tavern", "forge", "granary", "chapel",
    "smelter", "bunkhouse", "vault",
    "miller_house", "miller_barn", "oakford_house",
)

# Godot (x east, y up, z south) -> Blender Z-up (x, -z, y). glTF +Y up lands back in Godot.
def g2b(x, y, z):
    return (x, -z, y)


def b2g(x, y, z):
    return (x, z, -y)


# sRGB, the color the picture should show. glTF stores linear, so material() converts.
COLORS = {
    "stone": ((0.50, 0.48, 0.44, 1.0), 0.88),
    "soot": ((0.26, 0.24, 0.22, 1.0), 0.92),
    "limestone": ((0.66, 0.63, 0.56, 1.0), 0.84),
    "plaster": ((0.73, 0.66, 0.54, 1.0), 0.9),
    "plinth": ((0.24, 0.22, 0.20, 1.0), 0.94),
    "timber": ((0.32, 0.18, 0.09, 1.0), 0.78),
    "roof": ((0.52, 0.18, 0.12, 1.0), 0.86),
    "roof_dark": ((0.40, 0.13, 0.09, 1.0), 0.9),
    "roof_soot": ((0.16, 0.14, 0.13, 1.0), 0.94),
    "roof_straw": ((0.58, 0.40, 0.16, 1.0), 0.92),
    "slate": ((0.30, 0.33, 0.36, 1.0), 0.7),
    "glass": ((0.08, 0.11, 0.14, 1.0), 0.18),
    "sign": ((0.55, 0.12, 0.09, 1.0), 0.7),
    "plank": ((0.55, 0.40, 0.24, 1.0), 0.86),
}

# ridge x: eaves face north and south. ridge z: the south door sits in the gable.
STYLES = {
    "guild_hall": {"wall": "stone", "base_h": 0.0, "plinth": 0.4, "plinth_out": 0.1, "rise": 3.3, "ridge": "x", "overhang": 0.7, "verge": 0.4, "roof": "roof", "chimney": (0.76, -1.0, 0.85, 1.7), "frame": False, "sign": False, "string_y": 4.0, "hood": True},
    "tavern": {"wall": "stone", "upper": "plaster", "base_h": 2.55, "plinth": 0.36, "plinth_out": 0.08, "rise": 4.0, "ridge": "x", "overhang": 0.8, "verge": 0.45, "roof": "roof_dark", "chimney": (0.28, -1.0, 1.05, 2.0), "frame": True, "sign": True, "string_y": 0.0, "hood": True},
    "forge": {"wall": "soot", "base_h": 0.0, "plinth": 0.28, "plinth_out": 0.06, "rise": 1.7, "ridge": "x", "overhang": 0.95, "verge": 0.3, "roof": "roof_soot", "chimney": (0.8, -1.0, 1.15, 2.3), "frame": False, "sign": False, "string_y": 0.0, "hood": False, "bay": True},
    "granary": {"wall": "stone", "base_h": 0.0, "plinth": 0.82, "plinth_out": 0.16, "rise": 2.15, "ridge": "x", "overhang": 0.55, "verge": 0.3, "roof": "roof_straw", "chimney": None, "frame": False, "sign": False, "string_y": 0.0, "hood": True},
    "chapel": {"wall": "limestone", "base_h": 0.0, "plinth": 0.34, "plinth_out": 0.08, "rise": 3.6, "ridge": "z", "overhang": 0.4, "verge": 0.28, "roof": "slate", "chimney": None, "frame": False, "sign": False, "string_y": 0.0, "hood": True, "finial": True},
    "smelter": {"wall": "soot", "base_h": 0.0, "plinth": 0.35, "plinth_out": 0.1, "rise": 1.9, "ridge": "x", "overhang": 0.8, "verge": 0.35, "roof": "roof_soot", "chimney": (0.22, -1.0, 1.3, 2.6), "frame": False, "sign": False, "string_y": 0.0, "hood": False, "bay": True},
    "bunkhouse": {"wall": "stone", "base_h": 0.0, "plinth": 0.4, "plinth_out": 0.1, "rise": 1.7, "ridge": "x", "overhang": 0.55, "verge": 0.3, "roof": "slate", "chimney": (0.7, -1.0, 0.8, 1.5), "frame": False, "sign": False, "string_y": 0.0, "hood": True},
    "vault": {"wall": "stone", "base_h": 0.0, "plinth": 0.3, "plinth_out": 0.12, "rise": 0.85, "ridge": "x", "overhang": 0.28, "verge": 0.22, "roof": "slate", "chimney": None, "frame": False, "sign": False, "string_y": 0.0, "hood": False},
    "miller_house": {"wall": "plank", "base_h": 0.35, "plinth": 0.28, "plinth_out": 0.06, "rise": 2.3, "ridge": "x", "overhang": 0.55, "verge": 0.3, "roof": "roof_straw", "chimney": (0.72, -1.0, 0.7, 1.4), "frame": True, "sign": False, "string_y": 0.0, "hood": True},
    "miller_barn": {"wall": "plank", "base_h": 0.3, "plinth": 0.2, "plinth_out": 0.05, "rise": 2.5, "ridge": "x", "overhang": 0.7, "verge": 0.25, "roof": "roof_straw", "chimney": None, "frame": True, "sign": False, "string_y": 0.0, "hood": False, "bay": True},
    "oakford_house": {"wall": "stone", "upper": "plaster", "base_h": 1.15, "plinth": 0.3, "plinth_out": 0.08, "rise": 2.4, "ridge": "x", "overhang": 0.5, "verge": 0.28, "roof": "roof", "chimney": (0.3, 1.0, 0.65, 1.35), "frame": True, "sign": False, "string_y": 0.0, "hood": True},
}


def v(p):
    return mathutils.Vector((float(p[0]), float(p[1]), float(p[2])))


def poly_normal(pts):
    a = v(pts[1]) - v(pts[0])
    b = v(pts[2]) - v(pts[0])
    n = a.cross(b)
    if n.length < 1e-8:
        return None
    return n.normalized()


def bnormal_to_godot(n):
    return mathutils.Vector((n.x, n.z, -n.y))


class House:
    def __init__(self, building):
        floor = building["floor"]
        size = building["size"]
        self.id = building["id"]
        self.style = STYLES[self.id]
        self.thick = max(float(building["thick"]), 0.4)
        self.cx, self.y0, self.cz = (float(floor[0]), float(floor[1]), float(floor[2]))
        self.sx, self.sy, self.sz = (float(size[0]), float(size[1]), float(size[2]))
        self.minx = self.cx - self.sx * 0.5
        self.maxx = self.cx + self.sx * 0.5
        self.minz = self.cz - self.sz * 0.5
        self.maxz = self.cz + self.sz * 0.5
        self.y1 = self.y0 + self.sy
        self.doors = list(building["doors"])
        self.openings = list(building["openings"])
        self.windows = list(building.get("windows", []))
        self.buckets = {}
        self.gaps = {"+z": [], "-z": [], "+x": [], "-x": []}
        self.highs = []
        for spec in self.openings + self.doors:
            self.note_gap(spec)

    def mesh(self, name):
        bucket = self.buckets.get(name)
        if bucket is None:
            bucket = bmesh.new()
            self.buckets[name] = bucket
        return bucket

    def note_gap(self, spec):
        side = spec["side"]
        width = float(spec["width"])
        if side in ("+z", "-z"):
            span = {"x0": self.cx - width * 0.5, "x1": self.cx + width * 0.5}
            self.gaps[side].append(span)
            self.highs.append((side, span["x0"], span["x1"], float(spec["height"])))
        else:
            span = {"z0": self.cz - width * 0.5, "z1": self.cz + width * 0.5}
            self.gaps[side].append(span)
            self.highs.append((side, span["z0"], span["z1"], float(spec["height"])))

    def spans(self, side):
        start, end, key0, key1 = self.axis_span(side)
        cuts = sorted((float(gap[key0]), float(gap[key1])) for gap in self.gaps[side])
        out = []
        cursor = start
        for left, right in cuts:
            if left > cursor + 0.02:
                out.append((cursor, min(left, end)))
            cursor = max(cursor, right)
        if cursor < end - 0.02:
            out.append((cursor, end))
        return out

    def axis_span(self, side):
        if side in ("+z", "-z"):
            return self.minx, self.maxx, "x0", "x1"
        return self.minz, self.maxz, "z0", "z1"

    def add_box(self, name, center, size):
        sx, sy, sz = size
        if sx < 0.02 or sy < 0.02 or sz < 0.02:
            return
        loc = mathutils.Vector(g2b(center[0], center[1], center[2]))
        matrix = mathutils.Matrix.Translation(loc) @ mathutils.Matrix.Diagonal((sx, sz, sy, 1.0))
        bmesh.ops.create_cube(self.mesh(name), size=1.0, matrix=matrix)

    def add_poly(self, name, pts, outward):
        bm = self.mesh(name)
        verts = [bm.verts.new(mathutils.Vector(g2b(p.x, p.y, p.z))) for p in pts]
        try:
            face = bm.faces.new(verts)
        except ValueError:
            return
        face.smooth = False
        bm.normal_update()
        if bnormal_to_godot(face.normal).dot(outward) < 0.0:
            face.normal_flip()

    def add_slab(self, name, pts, thick):
        outward = poly_normal(pts)
        if outward is None:
            return
        outer = [v(p) for p in pts]
        inner = [p - outward * thick for p in outer]
        self.add_poly(name, outer, outward)
        self.add_poly(name, list(reversed(inner)), -outward)
        centroid = sum(outer, mathutils.Vector()) / len(outer)
        count = len(outer)
        for i in range(count):
            a = outer[i]
            b = outer[(i + 1) % count]
            c = inner[(i + 1) % count]
            d = inner[i]
            hint = (a + b) * 0.5 - centroid
            if hint.length < 1e-6:
                continue
            self.add_poly(name, [a, b, c, d], hint.normalized())

    def wall_box(self, side, a, b, y_lo, y_hi, name, proud=0.0):
        height = y_hi - y_lo
        length = b - a
        if height < 0.02 or length < 0.02:
            return
        thick = self.thick + proud
        mid_y = (y_lo + y_hi) * 0.5
        mid = (a + b) * 0.5
        if side == "+z":
            self.add_box(name, (mid, mid_y, self.maxz + proud * 0.5), (length, height, thick))
        elif side == "-z":
            self.add_box(name, (mid, mid_y, self.minz - proud * 0.5), (length, height, thick))
        elif side == "+x":
            self.add_box(name, (self.maxx + proud * 0.5, mid_y, mid), (thick, height, length))
        else:
            self.add_box(name, (self.minx - proud * 0.5, mid_y, mid), (thick, height, length))

    def outer(self, side, along, y, inset):
        face = self.thick * 0.5 + inset
        if side == "+z":
            return (along, y, self.maxz + face)
        if side == "-z":
            return (along, y, self.minz - face)
        if side == "+x":
            return (self.maxx + face, y, along)
        return (self.minx - face, y, along)

def subtract_fill(house):
    base = float(house.style["base_h"])
    upper = house.style.get("upper")
    for side in ("+z", "-z", "+x", "-x"):
        for a, b in house.spans(side):
            add_windowed_wall(house, side, a, b, house.y0, house.y1, base, upper)
            add_plinth(house, side, a, b)
        for side_name, a, b, height in house.highs:
            if side_name != side:
                continue
            # The greybox leaves the slot above a door empty. Fill the picture only.
            add_split_wall(house, side, a, b, house.y0 + height, house.y1, base, upper)
            add_lintel(house, side, a, b, house.y0 + height)


def add_windowed_wall(house, side, a, b, y_lo, y_hi, base, upper):
    middle = house.cx if side in ("+z", "-z") else house.cz
    windows = []
    cuts = {a, b}
    for window in house.windows:
        if window["side"] != side:
            continue
        left = middle + float(window["offset"]) - float(window["width"]) * 0.5
        right = left + float(window["width"])
        if right <= a or left >= b:
            continue
        bottom = house.y0 + float(window["sill"])
        windows.append((left, right, bottom, bottom + float(window["height"])))
        cuts.update((max(a, left), min(b, right)))
    cuts = sorted(cuts)
    for left, right in zip(cuts, cuts[1:]):
        cursor = y_lo
        gaps = sorted((bottom, top) for x0, x1, bottom, top in windows if x0 < (left + right) * 0.5 < x1)
        for bottom, top in gaps:
            add_split_wall(house, side, left, right, cursor, bottom, base, upper)
            cursor = top
        add_split_wall(house, side, left, right, cursor, y_hi, base, upper)


def add_split_wall(house, side, a, b, y_lo, y_hi, base, upper):
    if y_hi - y_lo < 0.02:
        return
    # base_h is a height above the floor. Town floors sit at y=0; the mine and farms do not.
    seam = house.y0 + base
    if upper and y_lo < seam < y_hi:
        house.wall_box(side, a, b, y_lo, seam, house.style["wall"])
        house.wall_box(side, a, b, seam, y_hi, upper)
        return
    name = upper if upper and y_lo >= seam - 0.01 else house.style["wall"]
    house.wall_box(side, a, b, y_lo, y_hi, name)


def add_plinth(house, side, a, b):
    height = float(house.style["plinth"])
    out = float(house.style["plinth_out"])
    if height < 0.05 or b - a < 0.02:
        return
    mid = (a + b) * 0.5
    y = house.y0 + height * 0.5
    face = house.thick * 0.5 + out * 0.5
    if side == "+z":
        house.add_box("plinth", (mid, y, house.maxz + face), (b - a, height, out))
    elif side == "-z":
        house.add_box("plinth", (mid, y, house.minz - face), (b - a, height, out))
    elif side == "+x":
        house.add_box("plinth", (house.maxx + face, y, mid), (out, height, b - a))
    else:
        house.add_box("plinth", (house.minx - face, y, mid), (out, height, b - a))


def add_lintel(house, side, a, b, y):
    board = 0.22
    reach = 0.16
    mid = (a + b) * 0.5
    length = (b - a) + reach * 2.0
    center = house.outer(side, mid, y + board * 0.15, 0.04)
    if side in ("+z", "-z"):
        house.add_box("timber", center, (length, board, 0.12))
    else:
        house.add_box("timber", center, (0.12, board, length))


def add_corners(house):
    name = "timber" if house.style.get("frame") else house.style["wall"]
    size = 0.36 if name == "timber" else 0.42
    h = house.y1 - house.y0
    y = house.y0 + h * 0.5
    face = house.thick * 0.5
    corners = (
        (house.minx - face, house.minz - face),
        (house.maxx + face, house.minz - face),
        (house.maxx + face, house.maxz + face),
        (house.minx - face, house.maxz + face),
    )
    for x, z in corners:
        house.add_box(name, (x, y, z), (size, h, size))


def add_string(house):
    y = float(house.style.get("string_y") or 0.0)
    if y <= house.y0 + 0.2 or y >= house.y1 - 0.2:
        return
    for side, a, b in (
        ("+z", house.minx, house.maxx),
        ("-z", house.minx, house.maxx),
        ("+x", house.minz, house.maxz),
        ("-x", house.minz, house.maxz),
    ):
        mid = (a + b) * 0.5
        center = house.outer(side, mid, y, 0.06)
        if side in ("+z", "-z"):
            house.add_box("plinth", center, (b - a, 0.16, 0.1))
        else:
            house.add_box("plinth", center, (0.1, 0.16, b - a))


def blocked(house, side, along, half, y, height):
    for gap_side, a, b, gap_h in house.highs:
        if gap_side != side:
            continue
        if along - half < b + 0.4 and along + half > a - 0.4:
            # Opening height is measured from the floor. Window y is absolute.
            if y - height * 0.5 < house.y0 + gap_h + 0.2:
                return True
    return False


def along_centers(house, side, count, width):
    start, end, _k0, _k1 = house.axis_span(side)
    margin = 0.85
    lo = start + margin
    hi = end - margin
    if hi - lo < width:
        return []
    n = count
    while n > 1 and (hi - lo) / (n - 1) < width + 0.7:
        n -= 1
    if n <= 1:
        mid = (start + end) * 0.5
        return [mid] if not blocked(house, side, mid, width * 0.5, house.y0 + 1.5, 1.0) else []
    step = (hi - lo) / (n - 1)
    return [lo + step * i for i in range(n)]


def add_window(house, side, along, y, w, h):
    if blocked(house, side, along, w * 0.5, y, h):
        return
    frame_y = h + 0.16
    if side in ("+z", "-z"):
        for shift in (-w * 0.5, w * 0.5):
            house.add_box("timber", house.outer(side, along + shift, y, 0.035), (0.08, frame_y, 0.08))
        for shift in (-h * 0.5, h * 0.5):
            house.add_box("timber", house.outer(side, along, y + shift, 0.035), (w, 0.08, 0.08))
    else:
        for shift in (-w * 0.5, w * 0.5):
            house.add_box("timber", house.outer(side, along + shift, y, 0.035), (0.08, frame_y, 0.08))
        for shift in (-h * 0.5, h * 0.5):
            house.add_box("timber", house.outer(side, along, y + shift, 0.035), (0.08, 0.08, w))


def add_windows(house):
    for window in house.windows:
        side = window["side"]
        middle = house.cx if side in ("+z", "-z") else house.cz
        center_y = house.y0 + float(window["sill"]) + float(window["height"]) * 0.5
        add_window(house, side, middle + float(window["offset"]), center_y, float(window["width"]), float(window["height"]))


def side_gap_top(house, side, fallback):
    top = fallback
    for gap_side, _a, _b, gap_h in house.highs:
        if gap_side == side:
            top = max(top, house.y0 + float(gap_h) + 0.18)
    return top


def along_in_gap(house, side, along):
    for gap_side, a, b, _h in house.highs:
        if gap_side == side and a - 0.15 < along < b + 0.15:
            return True
    return False


def add_frame(house):
    if not house.style.get("frame"):
        return
    base = house.y0 + float(house.style["base_h"])
    for side in ("+z", "-z", "+x", "-x"):
        start, end, _a, _b = house.axis_span(side)
        top = house.y1 - 0.14
        low = min(side_gap_top(house, side, base), top - 0.3)
        if top - low < 0.25:
            continue
        for y in (low, (low + house.y1) * 0.5, top):
            mid = (start + end) * 0.5
            length = (end - start) - 0.5
            center = house.outer(side, mid, y, 0.07)
            if side in ("+z", "-z"):
                house.add_box("timber", center, (length, 0.1, 0.08))
            else:
                house.add_box("timber", center, (0.08, 0.1, length))
        cursor = start + 1.05
        while cursor < end - 0.8:
            if along_in_gap(house, side, cursor):
                cursor += 2.55
                continue
            center = house.outer(side, cursor, (low + house.y1) * 0.5, 0.07)
            if side in ("+z", "-z"):
                house.add_box("timber", center, (0.1, house.y1 - low, 0.08))
            else:
                house.add_box("timber", center, (0.08, house.y1 - low, 0.1))
            cursor += 2.55


def add_bay(house):
    if not house.style.get("bay"):
        return
    for side, a, b, height in house.highs:
        # The barn mouth is 3.2 m and the smelter bay is 4 m. Town doors stay under 2.8 m.
        if b - a < 2.8:
            continue
        for along in (a, b):
            center = house.outer(side, along, house.y0 + height * 0.5, 0.02)
            if side in ("+z", "-z"):
                house.add_box("timber", center, (0.24, height, 0.24))
            else:
                house.add_box("timber", center, (0.24, height, 0.24))


def add_hoods(house):
    if not house.style.get("hood"):
        return
    for door in house.doors:
        side = door["side"]
        width = float(door["width"]) + 0.55
        y = house.y0 + float(door["height"]) + 0.1
        center = house.outer(side, house.cx if side in ("+z", "-z") else house.cz, y, 0.28)
        if side in ("+z", "-z"):
            house.add_box("timber", center, (width, 0.1, 0.5))
        else:
            house.add_box("timber", center, (0.5, 0.1, width))


def add_roof(house):
    style = house.style
    rise = float(style["rise"])
    oh = float(style["overhang"])
    verge = float(style["verge"])
    ye = house.y1
    yr = ye + rise
    roof = style["roof"]
    if style["ridge"] == "x":
        x0 = house.minx - verge
        x1 = house.maxx + verge
        zs = house.maxz + oh
        zn = house.minz - oh
        zr = house.cz
        south = [(x0, ye, zs), (x1, ye, zs), (x1, yr, zr), (x0, yr, zr)]
        north = [(x1, ye, zn), (x0, ye, zn), (x0, yr, zr), (x1, yr, zr)]
        house.add_slab(roof, south, 0.14)
        house.add_slab(roof, north, 0.14)
        west = [(x0, ye, zn), (x0, ye, zs), (x0, yr, zr)]
        east = [(x1, ye, zs), (x1, ye, zn), (x1, yr, zr)]
        gable = house.style.get("upper") or house.style["wall"]
        house.add_slab(gable, west, 0.12)
        house.add_slab(gable, east, 0.12)
        house.add_box("timber", ((x0 + x1) * 0.5, yr + 0.08, zr), (x1 - x0, 0.16, 0.24))
        house.add_box("timber", ((x0 + x1) * 0.5, ye + 0.06, zs), (x1 - x0, 0.14, 0.12))
        house.add_box("timber", ((x0 + x1) * 0.5, ye + 0.06, zn), (x1 - x0, 0.14, 0.12))
    else:
        z0 = house.minz - verge
        z1 = house.maxz + verge
        xe = house.maxx + oh
        xw = house.minx - oh
        xr = house.cx
        east = [(xe, ye, z0), (xr, yr, z0), (xr, yr, z1), (xe, ye, z1)]
        west = [(xw, ye, z1), (xr, yr, z1), (xr, yr, z0), (xw, ye, z0)]
        house.add_slab(roof, east, 0.14)
        house.add_slab(roof, west, 0.14)
        south = [(xw, ye, z1), (xe, ye, z1), (xr, yr, z1)]
        north = [(xe, ye, z0), (xw, ye, z0), (xr, yr, z0)]
        gable = house.style.get("upper") or house.style["wall"]
        house.add_slab(gable, south, 0.12)
        house.add_slab(gable, north, 0.12)
        house.add_box("timber", (xr, yr + 0.08, (z0 + z1) * 0.5), (0.24, 0.16, z1 - z0))
        house.add_box("timber", (xe, ye + 0.06, (z0 + z1) * 0.5), (0.12, 0.14, z1 - z0))
        house.add_box("timber", (xw, ye + 0.06, (z0 + z1) * 0.5), (0.12, 0.14, z1 - z0))


def roof_y(house, x, z):
    style = house.style
    if style["ridge"] == "x":
        half = (house.maxz - house.minz) * 0.5 + float(style["overhang"])
        dist = abs(z - house.cz)
    else:
        half = (house.maxx - house.minx) * 0.5 + float(style["overhang"])
        dist = abs(x - house.cx)
    dist = min(dist, half)
    return house.y1 + float(style["rise"]) * (1.0 - dist / half)


def add_chimney(house):
    spec = house.style["chimney"]
    if spec is None:
        return
    along, side, girth, height = spec
    if house.style["ridge"] == "x":
        x = house.minx + (house.maxx - house.minx) * along
        z = house.cz + side * house.sz * 0.28
    else:
        z = house.minz + (house.maxz - house.minz) * along
        x = house.cx + side * house.sx * 0.28
    y = roof_y(house, x, z)
    house.add_box(house.style["wall"], (x, y + height * 0.5 - 0.15, z), (girth, height, girth))
    house.add_box("plinth", (x, y + height - 0.05, z), (girth + 0.14, 0.14, girth + 0.14))


def add_finial(house):
    if not house.style.get("finial"):
        return
    x, z = house.cx, house.cz
    y = house.y1 + float(house.style["rise"])
    house.add_box(house.style["wall"], (x, y + 0.35, z), (0.42, 0.7, 0.42))
    house.add_box("timber", (x, y + 0.95, z), (0.08, 0.7, 0.08))
    house.add_box("timber", (x, y + 1.05, z), (0.46, 0.08, 0.08))


def add_sign(house):
    if not house.style.get("sign"):
        return
    x = house.cx + 2.5
    y = house.y0 + 3.35
    z = house.maxz + house.thick * 0.5
    house.add_box("timber", (x, y, z + 0.32), (0.08, 0.08, 0.64))
    house.add_box("sign", (x, y - 0.38, z + 0.6), (0.72, 0.58, 0.06))


def add_floor(house):
    name = "timber" if house.id in ("tavern", "guild_hall", "granary") else house.style["wall"]
    house.add_box(name, (house.cx, house.y0 + 0.04, house.cz), (house.sx - house.thick * 2.0 - 0.08, 0.08, house.sz - house.thick * 2.0 - 0.08))


def to_linear(channel):
    # glTF baseColorFactor is linear. The palette above is the sRGB color to see.
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def material(name):
    color, rough = COLORS[name]
    mat = bpy.data.materials.new("Town_" + name)
    mat.use_nodes = True
    principled = mat.node_tree.nodes.get("Principled BSDF")
    if principled is not None and "Base Color" in principled.inputs:
        principled.inputs["Base Color"].default_value = (to_linear(color[0]), to_linear(color[1]), to_linear(color[2]), color[3])
        if "Roughness" in principled.inputs:
            principled.inputs["Roughness"].default_value = rough
    mat.diffuse_color = color
    return mat


def emit(collection, house):
    objects = []
    for name, bm in house.buckets.items():
        if not bm.faces:
            bm.free()
            continue
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
        for face in bm.faces:
            face.smooth = False
        mesh = bpy.data.meshes.new(house.id + "_" + name)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        for poly in mesh.polygons:
            poly.use_smooth = False
        obj = bpy.data.objects.new(house.id + "_" + name, mesh)
        obj.data.materials.append(material(name))
        collection.objects.link(obj)
        objects.append(obj)
    return objects


def bounds(objects):
    xs, ys, zs = [], [], []
    for obj in objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            gx, gy, gz = b2g(world.x, world.y, world.z)
            xs.append(gx)
            ys.append(gy)
            zs.append(gz)
    return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)


def check(house, objects):
    x0, x1, y0, y1, z0, z1 = bounds(objects)
    rise = float(house.style["rise"])
    problems = []
    if x0 > house.minx - 0.15:
        problems.append("west")
    if x1 < house.maxx + 0.15:
        problems.append("east")
    if z0 > house.minz - 0.15:
        problems.append("north")
    if z1 < house.maxz + 0.15:
        problems.append("south")
    if y0 > house.y0 + 0.2:
        problems.append("floor")
    if y1 < house.y1 + rise * 0.75:
        problems.append("ridge")
    if problems:
        raise RuntimeError("%s bounds miss %s bbox=(%.2f..%.2f, %.2f..%.2f, %.2f..%.2f)" % (house.id, ",".join(problems), x0, x1, y0, y1, z0, z1))
    return x0, x1, y0, y1, z0, z1


def export(objects, path):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True, export_apply=True)


def build_one(collection, building):
    house = House(building)
    subtract_fill(house)
    add_corners(house)
    add_string(house)
    add_windows(house)
    add_frame(house)
    add_bay(house)
    add_hoods(house)
    add_roof(house)
    add_chimney(house)
    add_finial(house)
    add_sign(house)
    add_floor(house)
    objects = emit(collection, house)
    if not objects:
        raise RuntimeError(house.id + " produced no mesh")
    box = check(house, objects)
    path = OUT_DIR / (house.id + ".glb")
    export(objects, path)
    verts = sum(len(obj.data.vertices) for obj in objects)
    print("WISPIVA_TOWN %s verts=%d bbox=(%.1f..%.1f, %.1f..%.1f, %.1f..%.1f) file=%s" % (house.id, verts, box[0], box[1], box[2], box[3], box[4], box[5], path))


def main():
    bpy.ops.wm.read_homefile(use_empty=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    layout = json.loads(LAYOUT_PATH.read_text())
    buildings = {item["id"]: item for item in layout["buildings"]}
    collection = bpy.data.collections.new("Stonebridge")
    bpy.context.scene.collection.children.link(collection)
    for building_id in TOWN:
        build_one(collection, buildings[building_id])


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
