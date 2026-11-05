"""Pure, bounded genesis-to-Luanti plan compiler. No engine or filesystem access."""
from __future__ import annotations

import copy
import json

from .genesis import validate
from .interior import ROOM_START_SLOTS, scene_spawn_slots

# Compatible with the current agent's default horizontal bounds and spawn height;
# the caller must explicitly configure the runtime to match these values.
BOUND = 32
GRID_SPACING = 8
SPAWN_Y = 1
LEVEL_SPACING = 8
MIN_LEVEL = -1
SLOT_OFFSETS = tuple((x, z) for z in (-2, -1, 0, 1, 2) for x in (-2, -1, 0, 1, 2))
SITTING_ROOM_SLOTS = ROOM_START_SLOTS


class CompileError(ValueError):
    def __init__(self, code, diagnostics=()):
        super().__init__(code)
        self.code = code
        self.diagnostics = list(diagnostics)


def compile_plan(draft):
    """Return a fresh JSON-compatible plan; it contains private actor data."""
    try:
        # A JSON round trip prevents aliases, non-JSON objects and non-finite numbers.
        source = json.loads(json.dumps(draft, ensure_ascii=False, allow_nan=False))
        errors = validate(source)
    except (ValueError, TypeError, OverflowError, RecursionError, AttributeError):
        raise CompileError('invalid_draft') from None
    if errors:
        raise CompileError('invalid_draft', errors)
    if not 1 <= len(source['actors']) <= 64:
        raise CompileError('actor_count')

    # IDs are already validated as restricted ASCII identifiers, never paths.
    layout = {p['placeId']: p for p in source['layout']['places']}
    places = []
    for place in sorted(source['places'], key=lambda p: p['id']):
        item = layout[place['id']]
        gx, gz = item['grid']
        level = item.get('level', 0)
        floor_y = SPAWN_Y + level * LEVEL_SPACING
        x, z = gx * GRID_SPACING, gz * GRID_SPACING
        if abs(x) > BOUND or abs(z) > BOUND:
            raise CompileError('out_of_bounds', [{'path': '$.layout.places', 'code': 'place_out_of_bounds'}])
        public_place = {'id': place['id'], 'name': place['name'],
                        'description': place['description'], 'space': item['space'],
                        'grid': [gx, gz], 'anchor': {'x': x, 'y': floor_y, 'z': z}}
        if level != 0:
            public_place['level'] = level
        for field in ('floor', 'wall', 'ceiling', 'apron'):
            if field in item:
                public_place[field] = item[field]
        if item.get('windows') is True:
            public_place['windows'] = True
        if 'blueprint' in item:
            if abs(x) + 5 > BOUND or abs(z) + 4 > BOUND:
                raise CompileError('out_of_bounds', [{'path': '$.layout.places', 'code': 'blueprint_out_of_bounds'}])
            public_place['blueprint'] = item['blueprint']
        if 'scene' in item:
            if abs(x) + 5 > BOUND or abs(z) + 4 > BOUND:
                raise CompileError('out_of_bounds', [{'path': '$.layout.places', 'code': 'scene_out_of_bounds'}])
            public_place['scene'] = copy.deepcopy(item['scene'])
        places.append(public_place)
    # Existing box layouts retain their contract; detailed rooms reserve their
    # whole footprint rather than merely checking anchor-grid uniqueness.
    for i, place in enumerate(places):
        for other in places[:i]:
            if place['anchor']['y'] != other['anchor']['y']:
                continue
            if not (place.get('blueprint') or place.get('scene')
                    or other.get('blueprint') or other.get('scene')):
                continue
            def footprint(p):
                return (5, 4) if p.get('blueprint') or p.get('scene') else ((3, 3) if p['space'] == 'indoor' else (2, 2))
            ax, az = footprint(place)
            bx, bz = footprint(other)
            if (abs(place['anchor']['x'] - other['anchor']['x']) <= ax + bx
                    and abs(place['anchor']['z'] - other['anchor']['z']) <= az + bz):
                code = 'scene_overlap' if place.get('scene') or other.get('scene') else 'blueprint_overlap'
                raise CompileError('spatial_conflict', [{'path': '$.layout.places', 'code': code}])
    by_place = {p['id']: p for p in places}
    actors = sorted(source['actors'], key=lambda a: a['id'])
    occupants = {}
    public_actors, private_actors, occupied = [], {}, set()
    for ordinal, actor in enumerate(actors):
        place = by_place[actor['placeId']]
        slot = occupants.get(place['id'], 0)
        occupants[place['id']] = slot + 1
        slots = (SITTING_ROOM_SLOTS if place.get('blueprint') else
                 scene_spawn_slots(place['scene']) if place.get('scene') else SLOT_OFFSETS)
        if slot >= len(slots):
            raise CompileError('place_actor_capacity', [{'path': '$.actors', 'code': 'too_many_actors_at_place'}])
        dx, dz = slots[slot]
        position = {'x': place['anchor']['x'] + dx, 'y': place['anchor']['y'], 'z': place['anchor']['z'] + dz}
        if abs(position['x']) > BOUND or abs(position['z']) > BOUND:
            raise CompileError('out_of_bounds', [{'path': '$.actors', 'code': 'spawn_out_of_bounds'}])
        point = (position['x'], position['y'], position['z'])
        if point in occupied:
            raise CompileError('spatial_conflict', [{'path': '$.actors', 'code': 'spawn_collision'}])
        occupied.add(point)
        public_actors.append({'actor_id': actor['id'], 'ordinal': ordinal, 'name': actor['name'],
                              'place_id': place['id'], 'grid': place['grid'][:], 'position': position})
        private_actors[actor['id']] = {'role': actor['role'], 'goal': actor['goal'],
                                         'memory_seeds': [m['text'] for m in source['memories'] if m['actorId'] == actor['id']]}

    public_objects, private_objects = [], {}
    blueprint_blocked = {(-1, -1), (0, -1), (1, -1), (-2, 0), (2, 0)}
    for item in sorted(source.get('storyObjects', []), key=lambda value: value['id']):
        place = by_place[item['placeId']]
        dx, dz = item['at']
        detailed = 'blueprint' in place or 'scene' in place
        if (abs(dx) > (3 if detailed else 1) or abs(dz) > (2 if detailed else 1)
                or (place.get('blueprint') and (dx, dz) in blueprint_blocked)
                or (place.get('scene') and (dx, dz) in {
                    tuple(f['at']) for f in place['scene']['furnishings']})):
            raise CompileError('spatial_conflict',
                               [{'path': '$.storyObjects', 'code': 'object_unreachable'}])
        position = {'x': place['anchor']['x'] + dx, 'y': place['anchor']['y'],
                    'z': place['anchor']['z'] + dz}
        if abs(position['x']) > BOUND or abs(position['z']) > BOUND:
            raise CompileError('out_of_bounds',
                               [{'path': '$.storyObjects', 'code': 'object_out_of_bounds'}])
        point = (position['x'], position['y'], position['z'])
        if point in occupied:
            raise CompileError('spatial_conflict',
                               [{'path': '$.storyObjects', 'code': 'object_collision'}])
        occupied.add(point)
        public_objects.append({'id': item['id'], 'place_id': place['id'],
                               'position': position, 'node': item['node'],
                               'label': item['label'],
                               'render_by_state': copy.deepcopy(item['renderByState'])})
        private_objects[item['id']] = {
            'initial_state': item['initialState'], 'states': copy.deepcopy(item['states']),
            'reach': item['reach'], 'facets': copy.deepcopy(item['facets']),
            'grants': copy.deepcopy(item['grants']),
            'transitions': copy.deepcopy(item['transitions'])}

    connections = sorted(({'from': min(c['from'], c['to']), 'to': max(c['from'], c['to'])}
                          for c in source['layout']['connections']), key=lambda c: (c['from'], c['to']))
    return {
        'schema_version': 1,
        'public': {'title': source['title'], 'description': source['description'],
                   'bounds': {'min': {'x': -BOUND, 'y': SPAWN_Y + MIN_LEVEL * LEVEL_SPACING, 'z': -BOUND},
                    'max': {'x': BOUND, 'y': SPAWN_Y, 'z': BOUND}},
                   'grid_spacing': GRID_SPACING, 'places': places, 'actors': public_actors,
                   'semantic_connections': connections, 'objects': public_objects},
        'private_actors': private_actors,
        'private_objects': private_objects,
        'unsupported': ([{'code': 'descriptive_rule_not_executed', 'rule_id': r['id']}
                         for r in sorted(source['rules'], key=lambda r: r['id'])] +
                        [{'code': 'luanti_map_not_integrated'}, {'code': 'terrain_and_spawn_safety_unverified'},
                         {'code': 'semantic_connections_not_paths'}, {'code': 'character_runtime_not_integrated'}]),
    }


def public_plan(plan):
    """Copy only the compiler's public section; never return the private actor map."""
    return copy.deepcopy(plan['public'])
