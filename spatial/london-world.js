import { createRedHeadedWorld } from './red-headed-world.js';

const districtOffsets = {
  marylebone: [-480, 0, -240], fleet: [-180, 0, 40], 'west-end': [-312, 0, 100], city: [0, 0, 0],
};
const districtForSite = site => site.startsWith('baker-') ? 'marylebone'
  : site.startsWith('pope-court') || site.startsWith('fleet-') ? 'fleet'
    : site === 'st-jamess-hall' ? 'west-end' : 'city';
const districtForPlace = id => ['baker-street', 'sitting-room'].includes(id) ? 'marylebone'
  : ['fleet-street', 'pope-court', 'league-office'].includes(id) ? 'fleet'
    : id === 'music-hall' ? 'west-end' : 'city';
const shift = (point, delta) => point.map((value, axis) => value + delta[axis]);

// The novel crosses London by Underground and cab. Its detailed rooms retain
// their metric scale, while the intervening city is a compressed interpretation.
export function createLondonStoryWorld() {
  const source = createRedHeadedWorld();
  const cells = source.cells.filter(cell => cell[4] !== 'london-ground').map(cell => {
    const delta = districtOffsets[districtForSite(cell[4])];
    return [...cell.slice(0, 3).map((value, axis) => value + delta[axis] / source.unit), ...cell.slice(3)];
  });
  const props = source.props.map(prop => ({ ...prop, position: shift(prop.position, districtOffsets[districtForSite(prop.site)]) }));
  const places = source.places.map(place => {
    const delta = districtOffsets[districtForPlace(place.id)];
    return { ...place, district: districtForPlace(place.id), position: shift(place.position, delta), entry: shift(place.entry, delta),
      bounds: { min: shift(place.bounds.min, delta), max: shift(place.bounds.max, delta) },
      camera: { position: shift(place.camera.position, delta), target: shift(place.camera.target, delta) } };
  });
  const routes = source.routes.filter(route => districtForPlace(route.from) === districtForPlace(route.to)).map(route => ({
    ...route, points: route.points.map(point => shift(point, districtOffsets[districtForPlace(route.from)])),
  }));
  const residents = source.residents.map(resident => ({ ...resident, states: Object.fromEntries(Object.entries(resident.states).map(([id, state]) =>
    [id, { ...state, position: shift(state.position, districtOffsets[districtForPlace(state.placeId)]) }])) }));
  const surfaces = [];
  const extraExclusions = [];
  let serial = 0;
  const addBox = (site, position, size, material, extra = {}) => {
    props.push({ id: `london-prop-${++serial}`, kind: 'box', position, size, material, site, layer: 'exterior', ...extra });
  };
  const addSign = (site, position, size, text, rotation = 0) => {
    props.push({ id: `london-prop-${++serial}`, kind: 'sign', position, size, material: 'paint-green', ink: '#f1e9c8', text, rotation, site, layer: 'exterior' });
  };
  const fill = (site, x0, y0, z0, x1, y1, z1, material, layer = 'underground') => {
    for (let x = Math.round(x0 * 2); x < Math.round(x1 * 2); x++)
      for (let y = Math.round(y0 * 2); y < Math.round(y1 * 2); y++)
        for (let z = Math.round(z0 * 2); z < Math.round(z1 * 2); z++) cells.push([x, y, z, material, site, layer]);
  };
  function addPlace(id, name, position, entry, bounds, camera, district, interior = false, clipHeight) {
    places.push({ id, name, position, entry, bounds, camera, district, interior, site: id, ...(clipHeight === undefined ? {} : { clipHeight }) });
  }
  const streetRoute = (id, from, to, points) => routes.push({ id, from, to, points, mode: 'street' });
  addPlace('oxford-street', '牛津街', [-465, 0, -140], [-465, 0, -140],
    { min: [-540, -0.5, -149], max: [-320, 20, -131] }, { position: [-458, 3, -143], target: [-430, 2.5, -140] }, 'west-end');
  addPlace('the-park', '公园', [-434, 0, -70], [-434, 0, -104],
    { min: [-475, -0.5, -115], max: [-385, 20, -20] }, { position: [-437, 2.3, -104], target: [-431, 1.6, -70] }, 'west-end');
  addPlace('london-streets', '伦敦街道', [52, 0, -44], [52, 0, -44],
    { min: [-1e6, -0.5, -1e6], max: [1e6, 40, 1e6] }, { position: [52, 2.2, -44], target: [52, 1.6, -25] }, 'city');
  const parkBounds = { min: [-475, -115], max: [-385, -20] };
  extraExclusions.push(parkBounds);
  surfaces.push({ id: 'park-lawn', position: [-430, -0.006, -67.5], size: [90, 95], material: 'grass', site: 'the-park', layer: 'ground' });
  for (const [x, z] of [[-466, -107], [-454, -93], [-401, -106], [-396, -78], [-464, -52], [-410, -37], [-452, -29]]) {
    addBox('the-park', [x, 2.1, z], [0.5, 4.2, 0.5], 'timber');
    for (const [dx, dy, dz, size] of [[0, 4.5, 0, 3], [-1.2, 5.2, 0.3, 2.4], [0.5, 6, -0.5, 2.4]])
      addBox('the-park', [x + dx, dy, z + dz], [size, 1.5, size], 'laurel', { solid: false });
  }
  for (const [x, z] of [[-445, -88], [-421, -58], [-445, -33]]) {
    addBox('the-park', [x, 0.52, z], [2.2, 0.15, 0.65], 'wood');
    addBox('the-park', [x, 0.96, z - 0.3], [2.2, 0.8, 0.12], 'wood');
    for (const dx of [-0.85, 0.85]) addBox('the-park', [x + dx, 0.25, z], [0.12, 0.5, 0.55], 'iron');
  }
  streetRoute('baker-to-oxford', 'baker-street', 'oxford-street', [[-530, 0, -269], [-530, 0, -236], [-524, 0, -236], [-524, 0, -140], [-465, 0, -140]]);
  streetRoute('oxford-to-fleet', 'oxford-street', 'fleet-street', [[-465, 0, -140], [-332, 0, -140], [-332, 0, -44], [-186.5, 0, -44], [-186.5, 0, -4], [-180, 0, -4]]);
  streetRoute('oxford-to-park', 'oxford-street', 'the-park', [[-434, 0, -140], [-434, 0, -104], [-434, 0, -70]]);
  streetRoute('fleet-to-west-end', 'fleet-street', 'music-hall', [[-180, 0, -4], [-186.5, 0, -4], [-186.5, 0, -44], [-332, 0, -44], [-332, 0, 52], [-310, 0, 52], [-310, 0, 74.5], [-298, 0, 74.5], [-298, 0, 72.5]]);
  streetRoute('fleet-to-city', 'fleet-street', 'commercial-street', [[-180, 0, -4], [-186.5, 0, -4], [-186.5, 0, -44], [52, 0, -44], [52, 0, -18]]);
  streetRoute('commercial-to-king-edward', 'commercial-street', 'king-edward', [[52, 0, -18], [52, 0, -26.5], [47, 0, -26.5]]);
  streetRoute('city-to-london', 'commercial-street', 'london-streets', [[52, 0, -18], [52, 0, -44]]);

  function addStation(id, name, x, startZ, district) {
    const site = id, platformZ = startZ - 13;
    const bounds = { min: [x - 10, -5.5, platformZ - 5], max: [x + 10, 1, platformZ + 5] };
    fill(site, x - 10, -5.5, platformZ - 5, x + 10, -5, platformZ + 5, 'stone');
    fill(site, x - 10, -0.5, platformZ - 5, x + 10, 0, platformZ + 5, 'pavement', 'ground');
    for (const edge of [x - 10, x + 9.5]) fill(site, edge, -5, platformZ - 5, edge + 0.5, -1, platformZ + 5, 'brick-soot');
    fill(site, x - 10, -5, platformZ - 5, x + 10, -1, platformZ - 4.5, 'brick-soot');
    for (const [left, right] of [[x - 10, x - 1.5], [x + 1.5, x + 10]])
      fill(site, left, -5, platformZ + 4.5, right, -1, platformZ + 5, 'brick-soot');
    fill(site, x - 1, -0.5, startZ, x + 1, 0, startZ + 2, 'stone');
    const steps = [[x, 0, startZ + 1]];
    for (let index = 0; index <= 10; index++) {
      const top = -index * 0.5, z = startZ - index * 0.75;
      fill(site, x - 1, top - 0.5, z - 0.75, x + 1, top, z, 'stone');
      steps.push([x, top, z - 0.375]);
    }
    const entry = [x, -5, platformZ + 4];
    steps.push(entry);
    const staircase = { min: [x - 1.25, startZ - 8.5], max: [x + 1.25, startZ + 0.5] };
    extraExclusions.push({ min: [x - 12, platformZ - 6], max: [x + 12, startZ + 3] });
    addSign(site, [x, 2.4, startZ + 1], [4.6, 0.65, 0.08], `${name} · UNDERGROUND`, Math.PI);
    for (const dx of [-1.25, 1.25]) {
      addBox(site, [x + dx, 0.6, startZ - 3.6], [0.1, 1.2, 7.5], 'iron');
      addBox(site, [x + dx, 1.3, startZ + 1], [0.14, 2.6, 0.14], 'iron');
    }
    for (const dx of [-6, 0, 6]) {
      addBox(site, [x + dx, -2.2, platformZ], [0.18, 0.25, 8.7], 'iron', { layer: 'underground' });
      props.push({ id: `london-prop-${++serial}`, kind: 'lamp', position: [x + dx, -2.5, platformZ + 3.8], size: [0.24, 0.4, 0.24], material: 'brass', site, layer: 'underground' });
    }
    for (const dz of [-1, 1]) addBox(site, [x, -4.93, platformZ + dz], [18, 0.1, 0.1], 'iron', { solid: false, layer: 'underground' });
    for (let dx = -8; dx < 9; dx++) addBox(site, [x + dx, -4.96, platformZ], [0.18, 0.08, 2.5], 'wood', { solid: false, layer: 'underground' });
    addSign(site, [x + 5, -3.5, platformZ + 4.7], [3.8, 0.5, 0.06], name, Math.PI);
    addBox(site, [x - 5, -4.45, platformZ + 3.6], [3.2, 0.18, 0.65], 'wood', { layer: 'underground' });
    for (const dx of [-6.2, -3.8]) addBox(site, [x + dx, -4.73, platformZ + 3.6], [0.15, 0.54, 0.55], 'iron', { layer: 'underground' });
    addPlace(id, name, [x, -5, platformZ + 3], entry, bounds,
      { position: [x + 7, 0, platformZ + 10], target: [x, -4, platformZ] }, district, true, -2.8);
    return { steps, entry, staircase, landing: steps[0] };
  }
  const bakerStation = addStation('baker-underground', '贝克街地铁站', -539, -238, 'marylebone');
  const cityStation = addStation('aldersgate', 'Aldersgate 地铁站', -40, -60, 'city');
  routes.push({ id: 'baker-to-underground', from: 'baker-street', to: 'baker-underground', mode: 'stairs',
    points: [[-530, 0, -269], [-530, 0, -236], [-539, 0, -236], ...bakerStation.steps] });
  routes.push({ id: 'city-to-aldersgate', from: 'coburg-square', to: 'aldersgate', mode: 'stairs',
    points: [[-1, 0, 9], [-10, 0, 9], [-10, 0, -21], [-18, 0, -21], [-18, 0, -44], [-40, 0, -44], [-40, 0, -58], ...cityStation.steps] });
  routes.push({ id: 'underground-journey', from: 'baker-underground', to: 'aldersgate', mode: 'travel', points: [bakerStation.entry, cityStation.entry] });

  // Reserve authored architecture and actual connecting lanes before procedural
  // surrounding blocks are generated. Collision and rendering use this same map.
  const footprints = new Map();
  for (const cell of cells) {
    if (!['exterior', 'roof'].includes(cell[5]) || cell[1] < 0 || ['coburg-square', 'london-streets', 'city-cross-street'].includes(cell[4])) continue;
    let bounds = footprints.get(cell[4]);
    if (!bounds) { bounds = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] }; footprints.set(cell[4], bounds); }
    bounds.min[0] = Math.min(bounds.min[0], cell[0] * 0.5); bounds.min[1] = Math.min(bounds.min[1], cell[2] * 0.5);
    bounds.max[0] = Math.max(bounds.max[0], (cell[0] + 1) * 0.5); bounds.max[1] = Math.max(bounds.max[1], (cell[2] + 1) * 0.5);
  }
  const exclusions = [...extraExclusions,
    { min: [-20, -20], max: [61, 36] },
    { min: [-542, -282], max: [-506, -245] },
    { min: [-208, -10], max: [-183, 25] },
    ...[...footprints.values()].map(bounds => ({ min: bounds.min.map(value => value - 2), max: bounds.max.map(value => value + 2) })),
  ];
  for (const route of routes) {
    if (route.mode === 'travel') continue;
    for (let index = 1; index < route.points.length; index++) {
      const a = route.points[index - 1], b = route.points[index];
      if (a[1] < -0.5 || b[1] < -0.5) continue;
      exclusions.push({ min: [Math.min(a[0], b[0]) - 3.2, Math.min(a[2], b[2]) - 3.2],
        max: [Math.max(a[0], b[0]) + 3.2, Math.max(a[2], b[2]) + 3.2] });
      if (Math.hypot(a[0] - b[0], a[2] - b[2]) < 8) continue;
      surfaces.push({ id: `lane-${route.id}-${index}`, position: [(a[0] + b[0]) / 2, -0.003, (a[2] + b[2]) / 2],
        size: [Math.max(5.5, Math.abs(a[0] - b[0])), Math.max(5.5, Math.abs(a[2] - b[2]))], material: 'roadway', site: 'london-lanes', layer: 'ground' });
    }
  }
  const terrainExclusions = [...footprints.values(), bakerStation.staircase, cityStation.staircase];
  const occupancy = new Map(cells.map(cell => [cell.slice(0, 3).join(','), cell]));
  return { ...source, cells: [...occupancy.values()], props, places, routes, residents, surfaces,
    districts: [
      { id: 'marylebone', name: '马里波恩 · 贝克街', center: [-530, 0, -269] },
      { id: 'west-end', name: '伦敦西区', center: [-350, 0, -30] },
      { id: 'fleet', name: '舰队街与蒲柏巷', center: [-190, 0, 4] },
      { id: 'city', name: '伦敦城 · 科堡广场', center: [10, 0, 10] },
    ],
    terrain: { height: 0, exclusions: terrainExclusions },
    environment: { seed: 1890, blockSize: 96, origin: [52, -44], exclusions },
    arrival: { placeId: 'coburg-square', walking: true },
    overview: { position: [105, 80, 105], target: [10, 1, 10] },
  };
}
