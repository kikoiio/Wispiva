"""Bounded authoring rules for narrative-designed furnished interiors."""
from __future__ import annotations

from typing import Any

ROOM_START_SLOTS = (tuple((x, z) for z in (-2, 1) for x in range(-3, 4))
                    + tuple((x, 2) for x in range(-2, 3)) + ((0, 0),))
PALETTES = frozenset({'study', 'workshop', 'archive'})
FURNITURE = frozenset({'armchair', 'writing_desk', 'desk_chair',
                       'bookcase', 'table', 'side_table'})
FACINGS = frozenset({'north', 'east', 'south', 'west'})
BASIS = frozenset({'stated', 'inferred', 'author'})
MAX_FURNISHINGS = 8
FURNISHING_CELLS = tuple(sorted(
    {(x, z) for x in (-3, 3) for z in range(-1, 4)}
    | {(x, z) for z in (-3, 3) for x in range(-2, 3)}
))


def furnishing_cell(value: Any) -> tuple[int, int] | None:
    if (not isinstance(value, list) or len(value) != 2
            or any(type(part) is not int for part in value)):
        return None
    x, z = value
    # The center and east-door aisle at z=-2 stay open for movement and entry.
    if (x, z) not in FURNISHING_CELLS:
        return None
    return x, z


def scene_errors(scene: Any, path: str) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []

    def error(field: str, code: str) -> None:
        errors.append({'path': f'{path}{field}', 'code': code})

    if not isinstance(scene, dict) or set(scene) != {'version', 'palette', 'furnishings'}:
        error('', 'fields')
        return errors
    if type(scene['version']) is not int or scene['version'] != 1:
        error('.version', 'version')
    if not isinstance(scene['palette'], str) or scene['palette'] not in PALETTES:
        error('.palette', 'palette')
    items = scene['furnishings']
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_FURNISHINGS:
        error('.furnishings', 'array')
        return errors
    occupied: set[tuple[int, int]] = set()
    for index, item in enumerate(items):
        item_path = f'.furnishings[{index}]'
        required = {'kind', 'at', 'facing', 'basis'}
        if not isinstance(item, dict) or set(item) != required:
            error(item_path, 'fields')
            continue
        if not isinstance(item['kind'], str) or item['kind'] not in FURNITURE:
            error(item_path + '.kind', 'furniture')
        cell = furnishing_cell(item['at'])
        if cell is None:
            error(item_path + '.at', 'placement')
        elif cell in occupied:
            error(item_path + '.at', 'overlap')
        else:
            occupied.add(cell)
        if not isinstance(item['facing'], str) or item['facing'] not in FACINGS:
            error(item_path + '.facing', 'facing')
        if not isinstance(item['basis'], str) or item['basis'] not in BASIS:
            error(item_path + '.basis', 'basis')
    return errors


def scene_spawn_slots(scene: dict) -> tuple[tuple[int, int], ...]:
    """Return deterministic legacy room starts that remain free of furniture."""
    occupied = {tuple(item['at']) for item in scene['furnishings']}
    return tuple(slot for slot in ROOM_START_SLOTS if slot not in occupied)
