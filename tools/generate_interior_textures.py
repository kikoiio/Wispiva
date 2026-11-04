#!/usr/bin/env python3
"""Rebuild Wispiva's original 64px Victorian sitting-room textures.

Only Pillow and the standard library are used. No downloaded art, fonts, models,
reference-image pixels, or image-generation service is used in these assets.
Run from any directory; --output-dir can target a disposable comparison directory.
The reference informed the palette and subject matter, not the pixel data.
"""

from __future__ import annotations

import argparse
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 64
PREFIX = "society_interior_"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "engine/luanti/mod/society/textures"


def shade(color, amount):
    return tuple(max(0, min(255, round(c + amount))) for c in color)


def ground(color, seed=0, grain=1):
    """Low-amplitude wear, deliberately without speckled camouflage."""
    rng = random.Random(seed)
    image = Image.new("RGB", (SIZE, SIZE))
    image.putdata([
        shade(color, grain * (math.sin(x * 0.14) + math.cos(y * 0.18))
              + rng.choice((-1, 0, 0, 0, 1)))
        for y in range(SIZE) for x in range(SIZE)
    ])
    return image


def wood(seed=1, base=(80, 45, 28)):
    image = ground(base, seed)
    pixels = image.load()
    for y in range(SIZE):
        for x in range(SIZE):
            wave = x + 1.4 * math.sin(y / 19) + 0.4 * math.sin(y / 5)
            amount = 3 * math.sin(wave * 0.9) + 1.5 * math.sin(wave * 2.7)
            pixels[x, y] = shade(pixels[x, y], amount)
    draw = ImageDraw.Draw(image)
    for x in (7, 22, 43, 58):
        draw.line([(x, 0), (x - 1, 19), (x + 1, 42), (x, 63)], fill=shade(base, -9))
    return image


def bevel(draw, box, light, dark, width=1):
    x0, y0, x1, y1 = box
    for i in range(width):
        draw.line((x0 + i, y1 - i, x0 + i, y0 + i, x1 - i, y0 + i), fill=light)
        draw.line((x1 - i, y0 + i, x1 - i, y1 - i, x0 + i, y1 - i), fill=dark)


def fleur(draw, x, y, color, size=1):
    # A small heraldic lily, also reused as woven damask in the settee.
    draw.polygon([(x, y - 6 * size), (x - 2 * size, y - 2 * size),
                  (x, y + size), (x + 2 * size, y - 2 * size)], fill=color)
    draw.line((x, y - 2 * size, x, y + 6 * size), fill=color, width=size)
    for sign in (-1, 1):
        draw.line([(x, y + 2 * size), (x + sign * 4 * size, y - size),
                   (x + sign * 5 * size, y + size), (x + sign * 3 * size, y + 3 * size)],
                  fill=color, width=size)
    draw.line((x - 2 * size, y + 4 * size, x + 2 * size, y + 4 * size), fill=color)


def parquet():
    image = wood(2, (126, 78, 42))
    draw = ImageDraw.Draw(image)
    # Alternating basket-weave blocks: continuous at all four tile boundaries.
    for by in range(0, 64, 32):
        for bx in range(0, 64, 32):
            vertical = (bx // 32 + by // 32) % 2 == 0
            for i in range(4):
                rng = random.Random(bx * 200 + by * 9 + i)
                color = shade((132, 84, 46), rng.randrange(-10, 10))
                box = (bx + i * 8, by, bx + i * 8 + 7, by + 31) if vertical else (
                    bx, by + i * 8, bx + 31, by + i * 8 + 7)
                draw.rectangle(box, fill=color)
                bevel(draw, box, shade(color, 13), shade(color, -29))
                for j in (2, 4, 6):
                    if vertical:
                        draw.line((box[0] + j, by + 2, box[0] + j, by + 29), fill=shade(color, -4))
                    else:
                        draw.line((bx + 2, box[1] + j, bx + 29, box[1] + j), fill=shade(color, -4))
    return image


def wallpaper():
    image = ground((72, 83, 55), 3, 1.3)
    draw = ImageDraw.Draw(image)
    for y in range(-16, 81, 16):
        for x in range(-16, 81, 16):
            xx = x + (8 if (y // 16) % 2 else 0)
            draw.line([(xx, y - 8), (xx + 8, y), (xx, y + 8), (xx - 8, y), (xx, y - 8)],
                      fill=(77, 87, 57))
            fleur(draw, xx + 1, y + 1, (60, 71, 46))
            fleur(draw, xx, y, (124, 125, 78))
    return image


def panelling():
    image = wood(4)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 63, 7), fill=(100, 59, 33))
    bevel(draw, (0, 1, 63, 6), (139, 87, 46), (43, 25, 18), 2)
    for x in (3, 34):
        draw.rectangle((x, 13, x + 26, 57), fill=(65, 37, 25))
        bevel(draw, (x, 12, x + 26, 58), (127, 76, 39), (37, 24, 17), 2)
        bevel(draw, (x + 4, 17, x + 22, 53), (40, 25, 18), (104, 61, 33))
    draw.rectangle((0, 60, 63, 63), fill=(52, 31, 22))
    return image


def cornice():
    image = ground((199, 183, 151), 5)
    draw = ImageDraw.Draw(image)
    for y, color in ((1, (229, 215, 187)), (6, (155, 139, 113)), (9, (219, 204, 175)),
                     (20, (157, 141, 113)), (39, (144, 129, 105)), (44, (226, 211, 182)),
                     (50, (165, 149, 122)), (58, (226, 209, 180)), (63, (148, 131, 106))):
        draw.line((0, y, 63, y), fill=color)
    for x in range(1, 64, 8):
        draw.rectangle((x, 22, x + 5, 37), fill=(216, 201, 172))
        draw.line((x + 5, 23, x + 5, 38), fill=(130, 115, 95))
    return image


def hearth_stone():
    image = ground((63, 63, 59), 7, 1.5)
    draw = ImageDraw.Draw(image)
    for y in range(0, 64, 16):
        draw.line((0, y, 63, y), fill=(38, 37, 34))
        draw.line((0, y + 1, 63, y + 1), fill=(87, 85, 77))
        for x in range(-32 if (y // 16) % 2 else 0, 64, 32):
            draw.line((x, y, x, y + 15), fill=(38, 37, 34))
    draw.line((4, 11, 19, 7, 24, 8), fill=(74, 74, 67))
    draw.line((40, 38, 49, 34, 60, 35), fill=(76, 75, 69))
    return image


RUG_RED = (115, 44, 39)
RUG_CREAM = (195, 167, 113)
RUG_BLUE = (48, 64, 64)


def rosette(draw, x, y, outer=RUG_CREAM, inner=RUG_RED):
    draw.polygon([(x, y - 7), (x + 2, y - 3), (x + 6, y - 4), (x + 4, y),
                  (x + 6, y + 4), (x + 2, y + 3), (x, y + 7), (x - 2, y + 3),
                  (x - 6, y + 4), (x - 4, y), (x - 6, y - 4), (x - 2, y - 3)], fill=outer)
    draw.polygon([(x, y - 3), (x + 3, y), (x, y + 3), (x - 3, y)], fill=inner)
    draw.point((x, y), fill=(224, 197, 145))


def rug_center():
    image = ground(RUG_RED, 8)
    draw = ImageDraw.Draw(image)
    for y in range(-16, 81, 16):
        for x in range(-16, 81, 32):
            x += 16 if y % 32 else 0
            draw.line((x - 16, y, x, y - 8, x + 16, y), fill=(142, 82, 54))
            rosette(draw, x, y, RUG_CREAM, RUG_BLUE)
            for dx in (-10, 10):
                draw.line((x + dx, y - 2, x + dx, y + 2), fill=RUG_BLUE)
    # Quiet horizontal loom marks preserve the designed motif.
    pixels = image.load()
    for y in range(1, 64, 3):
        for x in range(64):
            pixels[x, y] = shade(pixels[x, y], -4)
    return image


def rug_border(corner=False):
    image = rug_center()
    draw = ImageDraw.Draw(image)
    # Top of the image is local -Z; left is local -X. Same distance field
    # joins edges and corners without extra borders at internal tile seams.
    bands = [(2, (74, 37, 31)), (4, RUG_CREAM), (6, RUG_BLUE), (8, RUG_CREAM),
             (18, (173, 139, 89)), (20, RUG_BLUE), (22, RUG_CREAM), (24, (76, 38, 32))]
    pixels = image.load()
    for y in range(64):
        for x in range(64):
            distance = min(x, y) if corner else y
            for end, color in bands:
                if distance < end:
                    pixels[x, y] = shade(color, -3 if y % 3 == 1 else 0)
                    break
    for x in range(40 if corner else 8, 64, 16):
        rosette(draw, x, 13, RUG_BLUE, RUG_CREAM)
    if corner:
        for y in range(40, 64, 16):
            rosette(draw, 13, y, RUG_BLUE, RUG_CREAM)
        # Match the first motif of the adjoining horizontal/vertical edge.
        rosette(draw, 13, 13, RUG_BLUE, RUG_RED)
    return image


def leather():
    image = ground((105, 40, 38), 11)
    pixels = image.load()
    for y in range(64):
        for x in range(64):
            row = round(y / 16)
            bx = round((x - (8 if row % 2 else 0)) / 16) * 16 + (8 if row % 2 else 0)
            by = row * 16
            distance = math.hypot(x - bx, y - by)
            pixels[x, y] = shade(pixels[x, y], -max(0, 19 - distance * 4))
    draw = ImageDraw.Draw(image)
    for y in range(-16, 81, 16):
        for x in range(-16, 81, 16):
            x += 8 if (y // 16) % 2 else 0
            draw.line((x - 8, y - 8, x, y, x + 8, y - 8), fill=(84, 31, 30))
            draw.ellipse((x - 1, y - 1, x + 1, y + 1), fill=(53, 27, 25))
            draw.point((x, y - 1), fill=(139, 65, 55))
    return image


def armchair_trim():
    image = leather()
    draw = ImageDraw.Draw(image)
    # UVs use node coordinates. Wood patches coincide with actual leg boxes;
    # the narrower upper back avoids repeating these patches above the cell.
    for x in (7, 51):
        draw.rectangle((x, 46, x + 5, 63), fill=(68, 39, 25))
        draw.line((x + 1, 48, x + 1, 61), fill=(112, 70, 35))
        draw.rectangle((x, 61, x + 5, 63), fill=(153, 111, 48))
    for x in range(5, 60, 4):
        draw.point((x, 43), fill=(204, 156, 71))
        draw.point((x, 44), fill=(88, 56, 30))
    for x in (3, 59):
        for y in range(17, 45, 4):
            draw.point((x, y), fill=(197, 146, 65))
    return image


def ochre():
    image = ground((151, 114, 48), 14)
    draw = ImageDraw.Draw(image)
    for y in range(-8, 73, 16):
        for x in range(-8, 73, 16):
            xx = x + (8 if (y // 16) % 2 else 0)
            draw.line((xx, y - 7, xx + 7, y, xx, y + 7, xx - 7, y, xx, y - 7),
                      fill=(123, 92, 40))
            fleur(draw, xx, y, (190, 150, 70))
    return image


def settee_front():
    image = ochre()
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 46, 63, 63), fill=(72, 42, 26))
    draw.line((0, 46, 63, 46), fill=(142, 94, 44))
    draw.line((0, 50, 63, 50), fill=(42, 27, 19))
    for x in range(3, 64, 4):
        draw.point((x, 44), fill=(214, 172, 84))
    return image


BOOKS = [(5, 10, 8, (82, 49, 32)), (11, 16, 6, (58, 68, 46)),
         (17, 23, 9, (112, 48, 34)), (24, 29, 7, (132, 91, 40)),
         (30, 35, 10, (49, 62, 57)), (36, 42, 6, (100, 51, 35)),
         (43, 48, 8, (109, 78, 39)), (49, 54, 5, (73, 66, 42)),
         (55, 58, 11, (98, 44, 33))]


def books():
    image = wood(17, (69, 39, 25))
    draw = ImageDraw.Draw(image)
    for left, right, top, color in BOOKS:
        draw.rectangle((left, top, right, 58), fill=color)
        draw.line((left, top, left, 58), fill=shade(color, 22))
        draw.line((right, top, right, 58), fill=shade(color, -24))
        for y in (top + 4, top + 6, 49, 52):
            draw.line((left + 1, y, right - 1, y), fill=(177, 134, 65))
        draw.rectangle((left + 1, 22, right - 1, 31), fill=shade(color, -13))
        for y in (25, 28):
            draw.line((left + 2, y, right - 2, y), fill=(178, 143, 82))
    draw.rectangle((0, 60, 63, 63), fill=(102, 60, 31))
    draw.line((0, 60, 63, 60), fill=(142, 89, 45))
    return image


def lettering(draw, xy, text, color):
    """Our own tiny block lettering: no installed or bundled font data."""
    glyphs = {
        "M": ("10001", "11011", "10101", "10101", "10001", "10001", "10001"),
        "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
        "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
        "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
        "I": ("11111", "00100", "00100", "00100", "00100", "00100", "11111"),
        "G": ("01111", "10000", "10000", "10111", "10001", "10001", "01110"),
        "C": ("01111", "10000", "10000", "10000", "10000", "10000", "01111"),
        "H": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
        "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
        "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    }
    for index, char in enumerate(text):
        for y, row in enumerate(glyphs[char]):
            for x, bit in enumerate(row):
                if bit == "1":
                    draw.point((xy[0] + index * 6 + x, xy[1] + y), fill=color)


def printed_paper(newspaper=False):
    image = ground((217, 202, 167), 18)
    draw = ImageDraw.Draw(image)
    ink = (74, 67, 54)
    if newspaper:
        # Original invented masthead and layout; no facsimile of an article.
        lettering(draw, (11, 4), "MORNING", ink)
        lettering(draw, (5, 14), "CHRONICLE", ink)
        draw.line((3, 24, 60, 24), fill=ink)
        draw.line((31, 26, 31, 61), fill=(158, 139, 107))
        draw.rectangle((35, 29, 59, 42), fill=(145, 136, 110))
        draw.polygon([(36, 39), (41, 34), (47, 38), (52, 31), (58, 39)], fill=(92, 90, 73))
        for x0, x1, y0, y1 in ((4, 28, 28, 61), (35, 59, 46, 61)):
            for y in range(y0, y1, 3):
                draw.line((x0, y, x1 - (y % 4), y), fill=(117, 106, 85))
                draw.point((x0 + (y % 8) + 5, y), fill=(217, 202, 167))
    else:
        draw.line((7, 8, 56, 8), fill=(159, 138, 101))
        for y in range(15, 53, 5):
            draw.line([(8, y), (15, y - 1), (20, y + 1), (31, y),
                       (38, y - 1), (54 - y % 6, y)], fill=(102, 91, 72))
        draw.line((35, 57, 52, 55), fill=(99, 84, 64))
    return image


def porcelain():
    image = ground((225, 224, 202), 19, 0.5)
    draw = ImageDraw.Draw(image)
    for a in (1, 4):
        draw.rectangle((a, a, 63 - a, 63 - a), outline=(170, 130, 61))
    for y in range(12, 64, 20):
        for x in range(12, 64, 20):
            draw.line((x - 4, y + 3, x + 3, y - 4), fill=(62, 93, 122))
            for dx, dy in ((0, 0), (-3, -2), (3, 2)):
                draw.ellipse((x + dx - 1, y + dy - 2, x + dx + 1, y + dy + 1), fill=(51, 81, 112))
    return image


def brass():
    image = ground((156, 116, 49), 20)
    draw = ImageDraw.Draw(image)
    for x, color in ((1, (204, 163, 76)), (4, (105, 76, 32)), (8, (181, 139, 58)),
                     (31, (199, 153, 67)), (59, (98, 71, 32)), (62, (209, 170, 83))):
        draw.line((x, 0, x, 63), fill=color)
    for y in (4, 59):
        draw.line((0, y, 63, y), fill=(198, 153, 65))
    return image


def curtain():
    image = ground((104, 34, 33), 21)
    pixels = image.load()
    for y in range(64):
        for x in range(64):
            amount = 14 * math.sin(2 * math.pi * x / 8) + 3 * math.sin(y / 9)
            pixels[x, y] = shade(pixels[x, y], amount)
    draw = ImageDraw.Draw(image)
    for y in range(-8, 73, 16):
        for x in range(4, 64, 16):
            fleur(draw, x, y, (117, 43, 39))
    return image


def window():
    image = Image.new("RGBA", (64, 64), (175, 202, 208, 27))
    draw = ImageDraw.Draw(image)
    # Flat alpha is intentional: the world beyond the window remains visible.
    for box in ((0, 0, 63, 3), (0, 60, 63, 63), (0, 0, 3, 63), (60, 0, 63, 63),
                (30, 0, 33, 63), (0, 30, 63, 33)):
        draw.rectangle(box, fill=(213, 206, 179, 255))
        bevel(draw, box, (235, 229, 205, 255), (146, 141, 121, 255))
    for x, y in ((8, 9), (39, 9), (8, 39), (39, 39)):
        draw.line((x, y + 10, x + 9, y), fill=(227, 238, 225, 65))
    return image


def fire():
    image = ground((25, 23, 21), 23, 0.3)
    draw = ImageDraw.Draw(image)
    for x, top, width, color in ((18, 30, 9, (170, 54, 17)), (26, 18, 9, (211, 82, 18)),
                                (36, 25, 8, (232, 117, 23)), (45, 32, 6, (188, 65, 17))):
        draw.polygon([(x - width, 53), (x - width + 3, top + 8), (x, top),
                      (x + 2, top + 13), (x + width, 47), (x + width - 2, 53)], fill=color)
        draw.polygon([(x - 3, 52), (x, top + 16), (x + 3, 50)], fill=(255, 199, 78))
    for y in (45, 49, 54):
        draw.line((8, y, 55, y), fill=(34, 31, 27), width=2)
    for x in (11, 23, 40, 52):
        draw.rectangle((x - 1, 38, x + 1, 57), fill=(38, 35, 30))
        draw.line((x - 1, 38, x - 1, 53), fill=(72, 64, 49))
    return image


def clock():
    image = brass()
    draw = ImageDraw.Draw(image)
    draw.ellipse((17, 29, 47, 59), fill=(95, 67, 29), outline=(219, 173, 78))
    draw.ellipse((19, 31, 45, 57), fill=(231, 219, 180), outline=(57, 47, 32))
    for hour in range(12):
        angle = hour * math.pi / 6
        x = 32 + round(10 * math.sin(angle))
        y = 44 - round(10 * math.cos(angle))
        draw.rectangle((x, y, x + 1, y + 1), fill=(49, 44, 34))
    draw.line((32, 44, 27, 39), fill=(40, 37, 29), width=2)
    draw.line((32, 44, 36, 36), fill=(40, 37, 29))
    draw.ellipse((31, 43, 33, 45), fill=(98, 64, 30))
    return image


def landscape():
    image = ground((164, 120, 43), 25)
    draw = ImageDraw.Draw(image)
    for inset, color in ((0, (79, 52, 24)), (1, (216, 168, 64)), (3, (119, 76, 26)),
                         (4, (220, 177, 80)), (6, (103, 67, 31)), (7, (225, 204, 159))):
        draw.rectangle((inset, inset, 63 - inset, 63 - inset), outline=color)
    draw.rectangle((8, 8, 55, 55), fill=(145, 164, 164))
    for y in range(9, 31, 5):
        draw.line((9 + y % 9, y, 35 + y % 12, y), fill=(194, 193, 169), width=2)
    draw.polygon([(8, 34), (19, 28), (26, 31), (36, 27), (55, 32), (55, 55), (8, 55)], fill=(92, 105, 78))
    draw.polygon([(38, 35), (45, 34), (36, 41), (48, 55), (31, 55), (30, 43)], fill=(161, 169, 148))
    draw.polygon([(8, 43), (23, 38), (32, 43), (30, 55), (8, 55)], fill=(112, 111, 68))
    draw.line((19, 24, 19, 45), fill=(73, 67, 43), width=2)
    for box in ((10, 17, 23, 30), (15, 13, 28, 24), (20, 22, 30, 33)):
        draw.ellipse(box, fill=(77, 91, 56))
    draw.ellipse((12, 17, 20, 24), fill=(109, 119, 67))
    for x, h in ((38, 4), (42, 7), (46, 5), (50, 3)):
        draw.rectangle((x, 33 - h, x + 2, 34), fill=(96, 99, 83))
    draw.line((43, 21, 43, 27), fill=(81, 88, 77))
    for x in range(4, 63, 6):
        draw.point((x, 2), fill=(238, 195, 94))
        draw.point((x, 61), fill=(238, 195, 94))
    return image


def lamp():
    image = brass()
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 24, 63, 40), fill=(35, 91, 48))
    for x in range(0, 64, 8):
        draw.line((x, 25, x, 39), fill=(48, 116, 58))
        draw.line((x + 6, 25, x + 6, 39), fill=(25, 68, 38))
    draw.line((0, 24, 63, 24), fill=(199, 156, 65))
    draw.line((0, 40, 63, 40), fill=(206, 170, 77))
    return image


def lamp_green():
    image = ground((37, 97, 51), 26)
    pixels = image.load()
    for y in range(64):
        for x in range(64):
            pixels[x, y] = shade(pixels[x, y], 5 * math.sin(math.pi*x/64)
                                  + 3 * math.cos(math.pi*y/32))
    return image


def table_top():
    image = wood(28, (102, 60, 33))
    draw = ImageDraw.Draw(image)
    bevel(draw, (0, 0, 63, 63), (146, 92, 45), (51, 30, 20), 2)
    for inset, color in ((5, (55, 34, 23)), (6, (166, 117, 58)),
                         (7, (113, 73, 37)), (10, (61, 38, 24))):
        draw.rectangle((inset, inset, 63 - inset, 63 - inset), outline=color)
    return image


def textures():
    assets = {
        "parquet": parquet(), "wallpaper": wallpaper(), "panelling": panelling(),
        "plaster": ground((204, 191, 163), 6, 0.7), "cornice": cornice(),
        "walnut": wood(), "hearth_stone": hearth_stone(),
        "rug_center": rug_center(), "rug_edge": rug_border(), "rug_corner": rug_border(True),
        "leather": leather(), "armchair_front": armchair_trim(),
        "ochre": ochre(), "settee_front": settee_front(), "books": books(),
        "newspaper": printed_paper(True), "papers": printed_paper(),
        "porcelain": porcelain(), "brass": brass(), "curtain": curtain(),
        "window": window(), "fire": fire(), "iron": ground((39, 37, 32), 24, 0.7),
        "clock": clock(), "landscape": landscape(), "lamp": lamp(),
        "lamp_green": lamp_green(), "table_top": table_top(),
    }
    for variant, material, extent in (
        ("paper", "newspaper", (6, 12, 57, 51)),
        ("tea", "porcelain", (7, 13, 56, 50)),
    ):
        # Nodeboxes share six face materials. Each combined table therefore has
        # two original 64px projections in one 64x128 atlas, selected with the
        # engine's sheet modifier. This keeps the kit at 30 tiny PNG files.
        top = assets["table_top"].copy()
        mask = Image.new("L", (64, 64))
        ImageDraw.Draw(mask).rectangle(extent, fill=255)
        top.paste(assets[material], (0, 0), mask)
        side = assets["walnut"].copy()
        pixels, source = side.load(), assets["papers" if variant == "paper" else material].load()
        # Table ends at local +.05 (row 29); accessory starts at +.06 (row 28).
        # Original accessory UVs shift by .55*64, rounding to the nearest pixel.
        for y in range(29):
            for x in range(64):
                pixels[x, y] = source[x, (y + 35) % 64]
        atlas = Image.new("RGB", (64, 128))
        atlas.paste(top, (0, 0))
        atlas.paste(side, (0, 64))
        assets[f"coffee_table_{variant}"] = atlas
    return assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    assets = textures()
    for name, image in sorted(assets.items()):
        expected = (SIZE, SIZE * 2) if name.startswith("coffee_table_") else (SIZE, SIZE)
        assert image.size == expected
        image.save(args.output_dir / f"{PREFIX}{name}.png", optimize=True)
    print(f"Wrote {len(assets)} original textures (64px faces; two double-height atlases) to {args.output_dir}")


if __name__ == "__main__":
    main()
