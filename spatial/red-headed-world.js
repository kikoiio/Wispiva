/**
 * Authored, deterministic voxel neighborhood for The Red-Headed League.
 * Cell coordinates are half-meter grid indices; all record coordinates are meters.
 */
export function createRedHeadedWorld() {
  const unit = 0.5;
  const cellsByPosition = new Map();
  const props = [];
  let propSerial = 0;
  const grid = (n) => Math.round(n / unit);
  const cellKey = (gx, gy, gz) => `${gx},${gy},${gz}`;
  const putCell = (gx, gy, gz, material, site, layer) => {
    cellsByPosition.set(cellKey(gx, gy, gz), [gx, gy, gz, material, site, layer]);
  };
  const fillBox = (x0, y0, z0, x1, y1, z1, material, site, layer) => {
    const gx0 = grid(x0), gy0 = grid(y0), gz0 = grid(z0);
    const gx1 = grid(x1), gy1 = grid(y1), gz1 = grid(z1);
    for (let gx = gx0; gx < gx1; gx++) {
      for (let gy = gy0; gy < gy1; gy++) {
        for (let gz = gz0; gz < gz1; gz++) putCell(gx, gy, gz, material, site, layer);
      }
    }
  };
  const eraseBox = (x0, y0, z0, x1, y1, z1) => {
    const gx0 = grid(x0), gy0 = grid(y0), gz0 = grid(z0);
    const gx1 = grid(x1), gy1 = grid(y1), gz1 = grid(z1);
    for (let gx = gx0; gx < gx1; gx++) {
      for (let gy = gy0; gy < gy1; gy++) {
        for (let gz = gz0; gz < gz1; gz++) cellsByPosition.delete(cellKey(gx, gy, gz));
      }
    }
  };
  const prop = (kind, position, size, material, site, layer = 'exterior', extra = {}) => {
    const record = { id: `prop-${++propSerial}`, kind, position, size, material, site, layer, ...extra };
    props.push(record);
    return record;
  };
  const box = (position, size, material, site, layer = 'interior', extra = {}) =>
    prop('box', position, size, material, site, layer, extra);
  const sign = (position, size, text, site, rotation = 0, layer = 'exterior', material = 'paper') =>
    prop('sign', position, size, material, site, layer, { text, rotation });
  const lamp = (position, size, material, site, layer = 'exterior') =>
    prop('lamp', position, size, material, site, layer, { emissive: true });

  const materials = {
    cobble: { color: '#625e57', pattern: 'stone' },
    roadway: { color: '#484947', pattern: 'stone' },
    pavement: { color: '#8b8172', pattern: 'stone' },
    'square-stone': { color: '#817b6d', pattern: 'stone' },
    'garden-earth': { color: '#514637', pattern: 'plain' },
    grass: { color: '#596449', pattern: 'plain' },
    laurel: { color: '#354735', pattern: 'plain' },
    flower: { color: '#8f4a40', pattern: 'plain' },
    brick: { color: '#70473b', pattern: 'brick' },
    'brick-red': { color: '#8b4939', pattern: 'brick' },
    'brick-soot': { color: '#52423d', pattern: 'brick' },
    'brick-light': { color: '#9a6754', pattern: 'brick' },
    plaster: { color: '#aa9a7e', pattern: 'wallpaper' },
    'plaster-cream': { color: '#c4b99e', pattern: 'wallpaper' },
    'wallpaper-green': { color: '#405447', pattern: 'wallpaper' },
    'wallpaper-cream': { color: '#b6a57d', pattern: 'wallpaper' },
    'panel-walnut': { color: '#49352a', pattern: 'wood' },
    wood: { color: '#694d36', pattern: 'wood' },
    timber: { color: '#59412d', pattern: 'wood' },
    floorboard: { color: '#795b3e', pattern: 'wood' },
    'roof-slate': { color: '#42464a', pattern: 'roof' },
    'roof-red': { color: '#784238', pattern: 'roof' },
    'roof-ochre': { color: '#8b6844', pattern: 'roof' },
    stone: { color: '#77746d', pattern: 'stone' },
    'vault-stone': { color: '#666661', pattern: 'stone' },
    marble: { color: '#b2aa97', pattern: 'stone' },
    iron: { color: '#303538', pattern: 'metal' },
    'iron-rust': { color: '#704b3d', pattern: 'metal' },
    brass: { color: '#aa8a48', pattern: 'metal' },
    gold: { color: '#bd9635', pattern: 'metal' },
    copper: { color: '#8e5b40', pattern: 'metal' },
    glass: { color: '#82958e', pattern: 'glass', transparent: true },
    'glass-warm': { color: '#bba77a', pattern: 'glass', transparent: true },
    paper: { color: '#d1c6a6', pattern: 'plain' },
    ink: { color: '#2e2d2a', pattern: 'plain' },
    cloth: { color: '#71685c', pattern: 'plain' },
    'velvet-red': { color: '#682f34', pattern: 'plain' },
    'rug-red': { color: '#773c3a', pattern: 'rug' },
    leather: { color: '#44342c', pattern: 'plain' },
    'tile-cream': { color: '#b7aa8a', pattern: 'stone' },
    'tile-blue': { color: '#53636a', pattern: 'stone' },
    coal: { color: '#272827', pattern: 'plain' },
    soot: { color: '#393533', pattern: 'plain' },
    earth: { color: '#574b3d', pattern: 'plain' },
    'gold-leaf': { color: '#c6a344', pattern: 'metal' },
    tobacco: { color: '#76523a', pattern: 'plain' },
    vegetables: { color: '#5c7143', pattern: 'plain' },
    'curtain-gold': { color: '#a17a3d', pattern: 'plain' },
    'paint-blue': { color: '#425661', pattern: 'plain' },
    'paint-red': { color: '#8c3f38', pattern: 'plain' },
    'paint-green': { color: '#4c614d', pattern: 'plain' },
    'paint-cream': { color: '#c3b69a', pattern: 'plain' },
    'paint-black': { color: '#17191a', pattern: 'plain' },
    'soot-black': { color: '#272624', pattern: 'brick' },
    'fire-orange': { color: '#e67b27', pattern: 'plain', emissive: '#c55216' },
    'fire-gold': { color: '#ffd077', pattern: 'plain', emissive: '#eea63e' },
    'autumn-ochre': { color: '#a17d3d', pattern: 'plain' },
    'autumn-russet': { color: '#81543a', pattern: 'plain' },
  };

  // The ground plane is continuous; streets, lanes, square, paths and lawns are
  // painted over it so every exterior route has voxel support at y=0.
  fillBox(-60, -0.5, -50, 60, 0, 50, 'cobble', 'london-ground', 'ground');
  const ground = (x0, z0, x1, z1, material, site = 'london-streets') =>
    fillBox(x0, -0.5, z0, x1, 0, z1, material, site, 'ground');
  ground(-60, -49, 60, -39, 'roadway', 'fleet-street');
  ground(47, -50, 60, 50, 'roadway', 'commercial-street');
  ground(-55, -40, -45, -17, 'roadway', 'baker-street');
  ground(-55, -27, -30, -20, 'roadway', 'baker-street');
  ground(-18, -20, 48, -15, 'roadway', 'city-cross-street');
  ground(-18, -15, -12, 21, 'roadway', 'city-cross-street');
  ground(-1, -4, 22, 24, 'square-stone', 'coburg-square');
  ground(-2, -5, 23, -3, 'pavement', 'coburg-square');
  ground(-2, 23.5, 23, 25, 'pavement', 'coburg-square');
  ground(-10, -5, -8, 25, 'pavement', 'coburg-square');
  ground(21.5, -5, 23.5, 25, 'pavement', 'coburg-square');
  ground(45.5, -15, 47.5, 34, 'pavement', 'commercial-street');
  ground(-56, -40, -54, -17, 'pavement', 'baker-street');
  ground(-18, -20, 48, -18, 'pavement', 'city-cross-street');
  ground(-18, -15, -16, 21, 'pavement', 'city-cross-street');
  ground(4, 2, 18, 18, 'grass', 'coburg-square');
  ground(5, 3, 17, 4.5, 'garden-earth', 'coburg-square');
  ground(5, 15.5, 17, 17, 'garden-earth', 'coburg-square');
  ground(5, 4, 6.5, 16, 'garden-earth', 'coburg-square');
  ground(15.5, 4, 17, 16, 'garden-earth', 'coburg-square');
  ground(6.5, 7, 15.5, 13, 'garden-earth', 'coburg-square');

  const wallCell = (gx, gy, gz, material, site) => putCell(gx, gy, gz, material, site, 'exterior');
  const frontAxis = (front) => (front === 'east' || front === 'west' ? 'z' : 'x');
  const frontValue = (b) => ({
    west: b.x0,
    east: b.x1 - unit,
    north: b.z0,
    south: b.z1 - unit,
  })[b.front];
  const windowCenters = (b) => {
    const axis = frontAxis(b.front);
    const lo = axis === 'z' ? b.z0 : b.x0;
    const hi = axis === 'z' ? b.z1 : b.x1;
    const centers = [];
    for (let c = lo + 2.25; c < hi - 1.5; c += 3.5) {
      if (b.doorAt === undefined || Math.abs(c - b.doorAt) > 1.5) centers.push(c);
    }
    if (!centers.length && hi - lo >= 5) centers.push((lo + hi) / 2 + 1.75);
    return centers;
  };
  const isFrontOpening = (b, along, y, groundLevel) => {
    if (!groundLevel || b.doorAt === undefined || y >= 2) return false;
    return Math.abs(along - b.doorAt) < 0.75;
  };
  const isFrontWindow = (b, along, y, windows) => {
    const inBand = (y >= 1 && y < 2) || (y >= 4 && y < 5);
    return inBand && windows.some((c) => Math.abs(along - c) < 0.5);
  };
  const buildRoof = (b) => {
    const x0 = grid(b.x0), x1 = grid(b.x1), z0 = grid(b.z0), z1 = grid(b.z1);
    const alongX = x1 - x0 >= z1 - z0;
    const depth = alongX ? z1 - z0 : x1 - x0;
    for (let d = 0; d < depth; d++) {
      const rise = Math.floor(Math.min(d, depth - 1 - d) / 2);
      const gy = grid(5.5) + rise;
      if (alongX) {
        for (let gx = x0; gx < x1; gx++) putCell(gx, gy, z0 + d, b.roofMaterial, b.id, 'roof');
      } else {
        for (let gz = z0; gz < z1; gz++) putCell(x0 + d, gy, gz, b.roofMaterial, b.id, 'roof');
      }
    }
    // Brick gables close the end walls without filling the roof volume.
    for (let gx of [x0, x1 - 1]) {
      if (alongX) {
        for (let gz = z0; gz < z1; gz++) {
          const rise = Math.floor(Math.min(gz - z0, z1 - 1 - gz) / 2);
          for (let r = 0; r < rise; r++) wallCell(gx, grid(5.5) + r, gz, b.wallMaterial, b.id);
        }
      }
    }
    for (let gz of [z0, z1 - 1]) {
      if (!alongX) {
        for (let gx = x0; gx < x1; gx++) {
          const rise = Math.floor(Math.min(gx - x0, x1 - 1 - gx) / 2);
          for (let r = 0; r < rise; r++) wallCell(gx, grid(5.5) + r, gz, b.wallMaterial, b.id);
        }
      }
    }
  };
  const buildBuilding = ({ id, x0, x1, z0, z1, front, doorAt, wallMaterial = 'brick',
    roofMaterial = 'roof-slate', floorMaterial = 'floorboard', upperFloor = true }) => {
    const b = { id, x0, x1, z0, z1, front, doorAt, wallMaterial, roofMaterial, floorMaterial };
    const windows = windowCenters(b);
    fillBox(x0, -0.5, z0, x1, 0, z1, floorMaterial, id, 'interior');
    if (upperFloor) fillBox(x0, 2.5, z0, x1, 3, z1, floorMaterial, id, 'interior');
    const facadePlane = frontValue(b);
    const addWall = (x, z, y, face, along) => {
      const isFront = face === front;
      if (isFront && isFrontOpening(b, along, y, y < 2.5)) return;
      let material = wallMaterial;
      if (isFront && isFrontWindow(b, along, y, windows)) material = 'glass';
      wallCell(grid(x), grid(y), grid(z), material, id);
    };
    for (let y0 = 0; y0 < 2.5; y0 += unit) {
      for (let z = z0; z < z1; z += unit) {
        addWall(x0, z, y0, 'west', z + unit / 2);
        addWall(x1 - unit, z, y0, 'east', z + unit / 2);
      }
      for (let x = x0; x < x1; x += unit) {
        addWall(x, z0, y0, 'north', x + unit / 2);
        addWall(x, z1 - unit, y0, 'south', x + unit / 2);
      }
    }
    if (upperFloor) {
      for (let y0 = 3; y0 < 5.5; y0 += unit) {
        for (let z = z0; z < z1; z += unit) {
          addWall(x0, z, y0, 'west', z + unit / 2);
          addWall(x1 - unit, z, y0, 'east', z + unit / 2);
        }
        for (let x = x0; x < x1; x += unit) {
          addWall(x, z0, y0, 'north', x + unit / 2);
          addWall(x, z1 - unit, y0, 'south', x + unit / 2);
        }
      }
      buildRoof(b);
    }
    b.windows = windows;
    b.facadePlane = facadePlane;
    return b;
  };
  const faceYaw = (front) => ({ west: -Math.PI / 2, east: Math.PI / 2, north: 0, south: Math.PI })[front];
  const facePoint = (b, along, y) => {
    if (b.front === 'west' || b.front === 'east') return [b.facadePlane, y, along];
    return [along, y, b.facadePlane];
  };
  const decorateBuilding = (b, { label, number, lampAtDoor = false, extraLamp = false, bay = false } = {}) => {
    const axis = frontAxis(b.front);
    const lo = axis === 'z' ? b.z0 : b.x0;
    const hi = axis === 'z' ? b.z1 : b.x1;
    const facadeLength = hi - lo;
    const cornice = b.front === 'west' || b.front === 'east'
      ? [[b.facadePlane, 2.55, (b.z0 + b.z1) / 2], [b.facadePlane, 5.55, (b.z0 + b.z1) / 2]]
      : [[(b.x0 + b.x1) / 2, 2.55, b.facadePlane], [(b.x0 + b.x1) / 2, 5.55, b.facadePlane]];
    const corniceSize = b.front === 'west' || b.front === 'east'
      ? [[0.16, 0.16, facadeLength], [0.16, 0.16, facadeLength]]
      : [[facadeLength, 0.16, 0.16], [facadeLength, 0.16, 0.16]];
    cornice.forEach((p, i) => box(p, corniceSize[i], 'stone', b.id, 'exterior'));
    const doorAlong = b.doorAt ?? (lo + hi) / 2;
    if (b.doorAt !== undefined) {
      const [fx, , fz] = facePoint(b, doorAlong, 1.05);
      const sideways = axis === 'z' ? [0.08, 2.1, 0.08] : [0.08, 2.1, 0.08];
      for (const side of [-0.7, 0.7]) {
        const p = axis === 'z' ? [fx, 1.05, fz + side] : [fx + side, 1.05, fz];
        box(p, sideways, 'wood', b.id, 'exterior');
      }
      const lintel = facePoint(b, doorAlong, 2.12);
      box(lintel, axis === 'z' ? [0.1, 0.12, 1.5] : [1.5, 0.12, 0.1], 'stone', b.id, 'exterior');
      const threshold = facePoint(b, doorAlong, -0.04);
      box(threshold, axis === 'z' ? [0.45, 0.08, 1.6] : [1.6, 0.08, 0.45], 'stone', b.id, 'exterior');
      if (number) {
        const signPoint = facePoint(b, doorAlong, 2.42);
        sign(signPoint, [0.85, 0.38, 0.08], number, b.id, faceYaw(b.front));
      }
      if (lampAtDoor) {
        const p = axis === 'z' ? [fx + 0.7, 2.25, fz] : [fx, 2.25, fz - 0.8];
        lamp(p, [0.24, 0.42, 0.24], 'brass', b.id);
      }
    }
    if (label) {
      const signY = 2.82;
      const p = facePoint(b, doorAlong, signY);
      sign(p, [Math.min(facadeLength - 1, 3.2), 0.62, 0.08], label, b.id, faceYaw(b.front));
    }
    for (const center of b.windows) {
      for (const level of [1.5, 4.5]) {
        const p = facePoint(b, center, level);
        const sideA = facePoint(b, center - 0.56, level);
        const sideB = facePoint(b, center + 0.56, level);
        const verticalSize = axis === 'z' ? [0.09, 1.35, 0.09] : [0.09, 1.35, 0.09];
        box(sideA, verticalSize, 'wood', b.id, 'exterior');
        box(sideB, verticalSize, 'wood', b.id, 'exterior');
        box(facePoint(b, center, level - 0.67), axis === 'z' ? [0.09, 0.08, 1.2] : [1.2, 0.08, 0.09], 'wood', b.id, 'exterior');
        box(facePoint(b, center, level + 0.67), axis === 'z' ? [0.09, 0.08, 1.2] : [1.2, 0.08, 0.09], 'wood', b.id, 'exterior');
        box(p, axis === 'z' ? [0.07, 1.25, 0.07] : [0.07, 1.25, 0.07], 'wood', b.id, 'exterior');
        const outward = ({ west: [-0.2, 0], east: [0.6, 0], north: [0, -0.2], south: [0, 0.6] })[b.front];
        const sill = facePoint(b, center, level - 0.7);
        sill[0] += outward[0]; sill[2] += outward[1];
        box(sill, axis === 'z' ? [0.24, 0.14, 1.45] : [1.45, 0.14, 0.24], 'stone', b.id, 'exterior');
        box([p[0] + outward[0], level, p[2] + outward[1]], axis === 'z' ? [0.08, 0.08, 1.05] : [1.05, 0.08, 0.08], 'paint-cream', b.id, 'exterior');
      }
    }
    // Roof stacks, rainwater pipes and drain shoes give each narrow terrace a
    // readable Victorian roofline and a small amount of individual character.
    const chimneyX = b.x0 + Math.min(1.25, facadeLength / 5);
    const chimneyZ = b.z0 + Math.min(1.25, (b.z1 - b.z0) / 5);
    box([chimneyX, 7.2, chimneyZ], [0.65, 1.5, 0.7], 'brick-soot', b.id, 'roof');
    box([chimneyX, 7.98, chimneyZ], [0.82, 0.12, 0.82], 'stone', b.id, 'roof');
    const pipeX = b.front === 'west' ? b.x1 - 0.18 : b.x0 + 0.18;
    const pipeZ = b.front === 'north' ? b.z1 - 0.18 : b.z0 + 0.18;
    box([pipeX, 3.0, pipeZ], [0.12, 6.0, 0.12], 'iron-rust', b.id, 'exterior');
    box([pipeX, 0.15, pipeZ], [0.28, 0.3, 0.22], 'iron-rust', b.id, 'exterior');
    if (bay && b.front === 'west') {
      const bayZ = doorAlong + 2.5;
      box([b.facadePlane - 0.25, 1.65, bayZ], [0.6, 1.4, 2.2], 'glass-warm', b.id, 'exterior');
      box([b.facadePlane - 0.25, 3.65, bayZ], [0.6, 1.1, 2.2], 'glass', b.id, 'exterior');
      box([b.facadePlane - 0.5, 0.9, bayZ], [0.15, 0.16, 2.4], 'stone', b.id, 'exterior');
    }
    if (extraLamp) {
      const p = axis === 'z' ? [b.facadePlane + (b.front === 'west' ? -0.8 : 0.8), 3.0, lo + 1.0] : [lo + 1.0, 3.0, b.facadePlane + (b.front === 'north' ? -0.8 : 0.8)];
      lamp(p, [0.25, 0.55, 0.25], 'brass', b.id);
    }
  };
  const blockHouse = (args, decor = {}) => {
    const b = buildBuilding(args);
    decorateBuilding(b, decor);
    return b;
  };

  // Baker Street 221B and the short connected row around it.
  const baker = blockHouse({ id: 'baker-221b', x0: -46, x1: -34, z0: -35, z1: -23, front: 'west', doorAt: -29, wallMaterial: 'brick-red', roofMaterial: 'roof-slate' },
    { label: '221B · 贝克街', number: '221B', lampAtDoor: true, bay: true });
  blockHouse({ id: 'baker-219', x0: -46, x1: -34, z0: -47, z1: -35, front: 'west', doorAt: -41, wallMaterial: 'brick-soot', roofMaterial: 'roof-red' }, { number: '219' });
  blockHouse({ id: 'baker-223', x0: -46, x1: -34, z0: -23, z1: -11, front: 'west', doorAt: -17, wallMaterial: 'brick-light', roofMaterial: 'roof-ochre' }, { number: '223' });
  blockHouse({ id: 'baker-west-terrace-a', x0: -60, x1: -54, z0: -40, z1: -28, front: 'east', doorAt: -34, wallMaterial: 'brick', roofMaterial: 'roof-red' });
  blockHouse({ id: 'baker-west-terrace-b', x0: -60, x1: -54, z0: -28, z1: -16, front: 'east', doorAt: -22, wallMaterial: 'brick-light', roofMaterial: 'roof-slate' });
  blockHouse({ id: 'baker-crossing-terrace', x0: -40, x1: -28, z0: -15, z1: -5, front: 'south', doorAt: -34, wallMaterial: 'brick-soot', roofMaterial: 'roof-red' });

  // Temporary League office, 7 Pope's Court, and the narrow application alley.
  const leagueOffice = blockHouse({ id: 'pope-court-no7', x0: -15, x1: -5, z0: -37, z1: -27, front: 'north', doorAt: -10, wallMaterial: 'plaster-cream', roofMaterial: 'roof-slate' },
    { label: '7 · 蒲柏巷', number: '7', lampAtDoor: true });
  blockHouse({ id: 'pope-court-north-house', x0: -25, x1: -15, z0: -37, z1: -27, front: 'south', doorAt: -20, wallMaterial: 'brick-soot', roofMaterial: 'roof-red' });
  blockHouse({ id: 'pope-court-south-house', x0: -25, x1: -15, z0: -27, z1: -17, front: 'north', doorAt: -20, wallMaterial: 'brick', roofMaterial: 'roof-ochre' });
  ground(-16, -42, -6, -37, 'cobble', 'pope-court');
  sign([-10, 2.75, -37.5], [3.4, 0.72, 0.08], '红发会办公室 · 7号', 'pope-court-no7', 0);
  sign([-10, 2.35, -37.48], [2.2, 0.62, 0.08], '红发会已解散\n1890年10月9日', 'pope-court-no7', 0, 'exterior', 'paper').chapters = ['investigation', 'heist', 'aftermath'];
  // The application-day queue is a static voxel tableau, not simulated residents.
  const crowd = [
    [-14.5, -38.4, '#8a4a33'], [-12.9, -39.2, '#bf6a37'], [-11.2, -38.5, '#b83f2e'],
    [-9.4, -39.3, '#7d5238'], [-7.7, -38.5, '#d58945'], [-13.8, -41.0, '#9b4434'],
    [-11.8, -41.4, '#61483c'], [-9.8, -41.0, '#c87042'], [-7.8, -41.3, '#9f6044'],
    [-15.1, -40.1, '#d9a153'], [-8.8, -40.2, '#8d422e'],
  ];
  for (const [i, [x, z, hair]] of crowd.entries()) {
    const crowdStart = props.length;
    const hairMaterial = 'crowd-hair-' + i;
    materials[hairMaterial] = { color: hair, pattern: 'plain' };
    box([x, 0.75, z], [0.38, 1.25, 0.32], 'cloth', 'pope-court', 'exterior');
    box([x, 1.62, z], [0.34, 0.36, 0.34], 'paint-cream', 'pope-court', 'exterior');
    box([x, 1.86, z], [0.38, 0.18, 0.38], hairMaterial, 'pope-court', 'exterior');
    box([x - 0.12, 0.14, z], [0.12, 0.28, 0.18], 'leather', 'pope-court', 'exterior');
    box([x + 0.12, 0.14, z], [0.12, 0.28, 0.18], 'leather', 'pope-court', 'exterior');
    for (let piece = crowdStart; piece < props.length; piece++) {
      Object.assign(props[piece], { chapters: ['league'], solid: false });
    }
  }

  // Saxe-Coburg Square: four dingy two-storey rows around a railed green.
  for (let x = -8, n = 0; x < 22; x += 7.5, n++) {
    const x1 = Math.min(22, x + 7.5);
    blockHouse({ id: `square-north-${n + 1}`, x0: x, x1, z0: -12, z1: -4, front: 'south', doorAt: (x + x1) / 2,
      wallMaterial: n % 2 ? 'brick-soot' : 'brick', roofMaterial: n % 2 ? 'roof-slate' : 'roof-red' }, { number: `${12 + n}` });
    blockHouse({ id: `square-south-${n + 1}`, x0: x, x1, z0: 24, z1: 32, front: 'north', doorAt: (x + x1) / 2,
      wallMaterial: n % 2 ? 'brick-light' : 'brick-soot', roofMaterial: n % 2 ? 'roof-ochre' : 'roof-slate' }, { number: `${19 + n}` });
  }
  blockHouse({ id: 'square-west-south', x0: -9, x1: -1, z0: -4, z1: 6, front: 'east', doorAt: 1, wallMaterial: 'brick-soot', roofMaterial: 'roof-red' });
  blockHouse({ id: 'square-west-north', x0: -9, x1: -1, z0: 12, z1: 24, front: 'east', doorAt: 18, wallMaterial: 'brick-light', roofMaterial: 'roof-ochre' });
  // The six-meter gap is the real western entrance into the square.
  ground(-14, 6, -9, 12, 'pavement', 'coburg-square');
  blockHouse({ id: 'square-east-north', x0: 22, x1: 34, z0: -12, z1: 3, front: 'west', doorAt: -5, wallMaterial: 'brick', roofMaterial: 'roof-slate' }, { number: '3' });
  const pawnshop = blockHouse({ id: 'jabez-wilson-pawnshop', x0: 22, x1: 34, z0: 3, z1: 15, front: 'west', doorAt: 9,
    wallMaterial: 'brick-red', roofMaterial: 'roof-red' }, { label: 'JABEZ WILSON', number: '3', lampAtDoor: true, bay: true });
  blockHouse({ id: 'square-east-south', x0: 22, x1: 34, z0: 15, z1: 27, front: 'west', doorAt: 21, wallMaterial: 'brick-soot', roofMaterial: 'roof-ochre' }, { number: '5' });

  // Slender rusted ironwork, with a full two-meter western gate opening.
  const gardenRail = (x0, z0, x1, z1) => {
    const length = Math.hypot(x1 - x0, z1 - z0), alongX = x0 !== x1;
    for (const y of [0.28, 0.96]) {
      box([(x0 + x1) / 2, y, (z0 + z1) / 2], alongX ? [length, 0.055, 0.055] : [0.055, 0.055, length], 'iron-rust', 'coburg-square', 'exterior');
    }
    const count = Math.ceil(length / 0.55);
    for (let i = 0; i <= count; i++) {
      const x = x0 + (x1 - x0) * i / count, z = z0 + (z1 - z0) * i / count;
      box([x, 0.58, z], [0.055, 1.16, 0.055], 'iron-rust', 'coburg-square', 'exterior');
      box([x, 1.18, z], [0.085, 0.1, 0.085], 'iron', 'coburg-square', 'exterior');
    }
  };
  gardenRail(5.25, 3.25, 16.75, 3.25);
  gardenRail(5.25, 16.75, 16.75, 16.75);
  gardenRail(16.75, 3.25, 16.75, 16.75);
  gardenRail(5.25, 3.25, 5.25, 9);
  gardenRail(5.25, 11, 5.25, 16.75);
  // Three sparse autumn trees and a few benches leave the weedy enclosure open.
  for (const [x, z] of [[2, 15], [19, 5], [3, 20]]) {
    box([x, 1.45, z], [0.22, 2.9, 0.22], 'timber', 'coburg-square', 'exterior');
    for (const [dx, dy, dz, size, material] of [[-0.55, 3.0, 0, 1.1, 'autumn-ochre'], [0.45, 3.35, 0.2, 1.25, 'autumn-russet'], [0, 3.95, -0.25, 0.9, 'autumn-ochre']]) {
      box([x + dx, dy, z + dz], [size, 0.65, size * 0.8], material, 'coburg-square', 'exterior', { solid: false });
    }
    box([x + 0.34, 2.6, z], [0.78, 0.12, 0.12], 'timber', 'coburg-square', 'exterior');
    for (let i = 0; i < 9; i++) {
      box([x - 1.1 + (i % 3) * 0.7, 0.015, z - 0.8 + Math.floor(i / 3) * 0.67], [0.19, 0.025, 0.13], i % 2 ? 'autumn-russet' : 'autumn-ochre', 'coburg-square', 'exterior', { rotation: i * 0.8, solid: false });
    }
  }
  for (const [x, z] of [[8, 20], [16, 20]]) {
    for (const dx of [-0.75, 0.75]) {
      for (const dz of [-0.25, 0.25]) box([x + dx, 0.23, z + dz], [0.09, 0.46, 0.09], 'iron', 'coburg-square', 'exterior');
      box([x + dx, 0.77, z + 0.29], [0.08, 0.64, 0.08], 'iron', 'coburg-square', 'exterior');
    }
    for (const dz of [-0.22, 0, 0.22]) box([x, 0.49, z + dz], [2.0, 0.09, 0.16], 'wood', 'coburg-square', 'exterior');
    for (const y of [0.79, 1.02]) box([x, y, z + 0.3], [2.0, 0.15, 0.09], 'wood', 'coburg-square', 'exterior');
  }
  for (const [x, z] of [[7, 6], [13, 13], [9, 15], [15, 7]]) {
    box([x, 0.55, z], [1.3, 0.9, 1.2], 'laurel', 'coburg-square', 'exterior');
    box([x, 1.05, z], [0.7, 0.35, 0.75], 'laurel', 'coburg-square', 'exterior');
  }
  for (const [x, z] of [[2, 2], [19, 2], [2, 21], [19, 21], [-12, 10], [25, 20]]) {
    box([x, 1.6, z], [0.18, 3.2, 0.18], 'iron-rust', 'coburg-square', 'exterior');
    box([x, 3.25, z], [0.42, 0.18, 0.42], 'brass', 'coburg-square', 'exterior');
    lamp([x, 3.55, z], [0.45, 0.65, 0.45], 'brass', 'coburg-square');
  }

  // The commercial row runs in the exact order Holmes recites along the busy street.
  const mortimer = blockHouse({ id: 'mortimers-tobacconist', x0: 34, x1: 46, z0: -13, z1: -5, front: 'east', doorAt: -9,
    wallMaterial: 'brick-soot', roofMaterial: 'roof-slate' }, { label: 'MORTIMER · 烟草', lampAtDoor: true });
  const newspaper = blockHouse({ id: 'city-newspaper-shop', x0: 34, x1: 46, z0: -5, z1: 3, front: 'east', doorAt: -1,
    wallMaterial: 'brick-light', roofMaterial: 'roof-red' }, { label: '晨报 · 新闻', lampAtDoor: true });
  const bank = blockHouse({ id: 'city-suburban-bank', x0: 34, x1: 46, z0: 3, z1: 15, front: 'east', doorAt: 9,
    wallMaterial: 'stone', roofMaterial: 'roof-slate' }, { label: 'CITY & SUBURBAN BANK', lampAtDoor: true });
  const restaurant = blockHouse({ id: 'vegetarian-restaurant', x0: 34, x1: 46, z0: 15, z1: 23, front: 'east', doorAt: 19,
    wallMaterial: 'brick-red', roofMaterial: 'roof-ochre' }, { label: '素食餐馆', lampAtDoor: true });
  const carriageDepot = blockHouse({ id: 'mcfarlanes-carriage-depot', x0: 34, x1: 46, z0: 23, z1: 33, front: 'east', doorAt: 28,
    wallMaterial: 'brick', roofMaterial: 'roof-red' }, { label: '麦克法兰马车厂', lampAtDoor: true });

  // Additional north-of-square London terraces and small workshops.
  blockHouse({ id: 'city-cross-north-a', x0: -8, x1: 4, z0: -15, z1: -8, front: 'south', doorAt: -2, wallMaterial: 'brick-light', roofMaterial: 'roof-slate' });
  blockHouse({ id: 'city-cross-north-b', x0: 4, x1: 17, z0: -15, z1: -8, front: 'south', doorAt: 10, wallMaterial: 'brick-soot', roofMaterial: 'roof-red' });
  blockHouse({ id: 'fleet-south-terrace-a', x0: -60, x1: -48, z0: -58, z1: -50, front: 'south', doorAt: -54, wallMaterial: 'brick', roofMaterial: 'roof-ochre' });
  blockHouse({ id: 'fleet-south-terrace-b', x0: -48, x1: -36, z0: -58, z1: -50, front: 'south', doorAt: -42, wallMaterial: 'brick-soot', roofMaterial: 'roof-slate' });
  blockHouse({ id: 'fleet-north-terrace-a', x0: -36, x1: -24, z0: -58, z1: -50, front: 'south', doorAt: -30, wallMaterial: 'brick-light', roofMaterial: 'roof-red' });
  blockHouse({ id: 'fleet-north-terrace-b', x0: -24, x1: -12, z0: -58, z1: -50, front: 'south', doorAt: -18, wallMaterial: 'brick', roofMaterial: 'roof-slate' });

  // St James's Hall: concert frontage, auditorium, stage, stalls, and side boxes.
  const musicHall = blockHouse({ id: 'st-jamess-hall', x0: 6, x1: 22, z0: -38, z1: -27, front: 'south', doorAt: 14,
    wallMaterial: 'stone', roofMaterial: 'roof-slate' }, { label: 'ST JAMES’S HALL', lampAtDoor: true });
  sign([14, 4.2, -26.4], [4.2, 0.72, 0.08], '今晚：萨拉萨泰小提琴音乐会', 'st-jamess-hall', Math.PI, 'exterior', 'paper');
  box([14, 0.35, -37.2], [11.5, 0.45, 0.4], 'wood', 'st-jamess-hall', 'interior');
  box([14, 0.95, -37.4], [10.4, 1.0, 0.12], 'velvet-red', 'st-jamess-hall', 'interior');
  box([14, 0.5, -37.0], [10.5, 0.35, 1.6], 'wood', 'st-jamess-hall', 'interior');
  box([14, 0.85, -37.55], [10.0, 0.55, 0.22], 'velvet-red', 'st-jamess-hall', 'interior');
  for (let row = 0; row < 5; row++) {
    const z = -35 + row * 1.1;
    for (let seat = 0; seat < 7; seat++) {
      const x = 9.0 + seat * 1.65;
      if (seat === 3) continue; // central aisle remains clear
      box([x, 0.45, z], [1.0, 0.28, 0.72], 'wood', 'st-jamess-hall', 'interior');
      box([x, 0.88, z + 0.22], [0.88, 0.75, 0.18], 'velvet-red', 'st-jamess-hall', 'interior');
    }
  }
  for (const x of [7.6, 20.4]) {
    box([x, 1.25, -33.0], [0.35, 2.5, 0.35], 'brass', 'st-jamess-hall', 'interior');
    lamp([x, 2.65, -33.0], [0.55, 0.68, 0.55], 'brass', 'st-jamess-hall', 'interior');
  }
  box([15.8, 0.65, -29.3], [0.08, 0.08, 0.72], 'wood', 'st-jamess-hall', 'interior', { rotation: 0.15 });
  box([15.8, 0.78, -29.3], [0.08, 0.38, 0.08], 'wood', 'st-jamess-hall', 'interior');

  // 17 King Edward Street, the false lead: a neat industrial frontage making knee-caps.
  const kneeFactory = blockHouse({ id: 'king-edward-kneecap-factory', x0: 38, x1: 47, z0: -32, z1: -21, front: 'east', doorAt: -26.5,
    wallMaterial: 'brick-light', roofMaterial: 'roof-red' }, { label: '人工膝盖护具厂', number: '17', lampAtDoor: true });
  sign([47.45, 3.5, -26.5], [5.0, 0.65, 0.08], '17 KING EDWARD STREET', 'king-edward-kneecap-factory', Math.PI / 2, 'exterior', 'paper');
  box([41.5, 0.95, -24], [3.2, 1.9, 0.45], 'wood', 'king-edward-kneecap-factory', 'interior');
  for (let i = 0; i < 5; i++) box([40.5 + i * 1.0, 0.5, -30.2], [0.75, 0.5, 0.55], 'leather', 'king-edward-kneecap-factory', 'interior');

  // Store interiors, each laid out around its real doorway and an unobstructed aisle.
  sign([45.55, 3.0, -9], [4.4, 0.58, 0.08], '烟叶与烟斗', 'mortimers-tobacconist', Math.PI / 2, 'exterior');
  for (let z = -12; z <= -6; z += 2) {
    box([43.4, 1.3, z], [0.48, 1.9, 1.6], 'wood', 'mortimers-tobacconist');
    box([43.12, 1.6, z], [0.12, 0.65, 1.25], 'tobacco', 'mortimers-tobacconist');
  }
  box([39.0, 1.05, -10.8], [3.8, 0.22, 1.1], 'wood', 'mortimers-tobacconist');
  box([39.0, 1.42, -10.8], [3.9, 0.12, 1.2], 'panel-walnut', 'mortimers-tobacconist');
  sign([39, 2.35, -10.2], [2.6, 0.45, 0.08], '雪茄 · 鼻烟 · 烟斗', 'mortimers-tobacconist', 0, 'interior');

  sign([45.55, 3.0, -1], [4.4, 0.58, 0.08], '晨报', 'city-newspaper-shop', Math.PI / 2, 'exterior');
  box([42.5, 0.72, 0.1], [5.2, 0.45, 1.0], 'wood', 'city-newspaper-shop');
  for (let i = 0; i < 8; i++) {
    box([40.2 + (i % 4) * 1.2, 1.02 + Math.floor(i / 4) * 0.08, -0.2], [0.75, 0.04, 0.62], 'paper', 'city-newspaper-shop');
  }
  for (let z = -4; z < 2; z += 1.5) box([35.5, 1.4, z], [1.2, 2.1, 0.12], 'wood', 'city-newspaper-shop');
  sign([43.4, 2.05, 0.2], [2.6, 0.45, 0.08], 'THE MORNING CHRONICLE', 'city-newspaper-shop', 0, 'interior');

  // Bank hall furniture and a floor opening above the independent underground vault.
  box([41.5, 0.38, 9.0], [4.8, 0.48, 1.1], 'marble', 'city-suburban-bank');
  box([41.5, 0.78, 9.0], [4.9, 0.14, 1.2], 'wood', 'city-suburban-bank');
  for (const x of [39.0, 44.0]) {
    for (const z of [5.0, 13.0]) {
      box([x, 2.0, z], [0.55, 4.0, 0.55], 'stone', 'city-suburban-bank');
      box([x, 4.05, z], [0.9, 0.2, 0.9], 'brass', 'city-suburban-bank');
    }
  }
  box([39.5, 1.2, 13.25], [3.0, 2.2, 0.3], 'iron', 'city-suburban-bank');
  box([39.5, 1.8, 13.08], [2.6, 0.35, 0.08], 'brass', 'city-suburban-bank');
  sign([39.5, 2.1, 13.0], [2.8, 0.45, 0.08], '本行柜台', 'city-suburban-bank', 0, 'interior');
  // Open the bank hall slab for its broad descending stone stair.
  eraseBox(35, -0.5, 4, 37, 0, 10);

  sign([45.55, 3.0, 19], [4.6, 0.58, 0.08], '素食 · 热汤', 'vegetarian-restaurant', Math.PI / 2, 'exterior');
  for (const z of [17.2, 20.6]) {
    box([40.0, 0.75, z], [2.1, 0.18, 1.25], 'wood', 'vegetarian-restaurant');
    for (const x of [39.35, 40.65]) box([x, 0.43, z], [0.12, 0.65, 0.12], 'wood', 'vegetarian-restaurant');
    for (const x of [39.0, 41.0]) box([x, 0.52, z + 0.75], [0.8, 0.16, 0.8], 'wood', 'vegetarian-restaurant');
  }
  box([43.6, 1.05, 21.7], [0.35, 1.9, 1.1], 'wood', 'vegetarian-restaurant');
  for (let i = 0; i < 6; i++) box([43.4, 1.35, 20.0 + i * 0.42], [0.22, 0.25, 0.26], 'vegetables', 'vegetarian-restaurant');
  sign([40.0, 2.05, 22.5], [3.4, 0.42, 0.08], '无肉菜单 · 当日蔬菜', 'vegetarian-restaurant', 0, 'interior');

  box([39.5, 0.55, 27.0], [7.0, 0.18, 5.0], 'wood', 'mcfarlanes-carriage-depot');
  for (const x of [37.0, 42.0, 44.5]) {
    box([x, 1.25, 25.0], [0.12, 2.5, 0.12], 'wood', 'mcfarlanes-carriage-depot');
    box([x, 1.25, 29.0], [0.12, 2.5, 0.12], 'wood', 'mcfarlanes-carriage-depot');
  }
  box([40.0, 1.4, 27.0], [4.0, 0.32, 1.0], 'iron', 'mcfarlanes-carriage-depot');
  box([40.0, 0.8, 27.0], [3.1, 0.28, 0.8], 'wood', 'mcfarlanes-carriage-depot');
  for (const x of [38.5, 41.5]) box([x, 0.5, 26.2], [0.68, 0.18, 0.68], 'iron', 'mcfarlanes-carriage-depot');

  // Pawnshop fixtures: three gilded balls, a named board, counter, clocks, pledges and shelves.
  for (const [x, z] of [[-0.45, 7.7], [-0.45, 9], [-0.45, 10.3]]) {
    box([x + 22, 2.85, z], [0.5, 0.5, 0.5], 'gold-leaf', 'jabez-wilson-pawnshop', 'exterior');
  }
  sign([21.45, 2.0, 9], [3.8, 0.7, 0.08], 'JABEZ WILSON', 'jabez-wilson-pawnshop', -Math.PI / 2, 'exterior', 'paper');
  box([27.8, 1.05, 5.7], [5.2, 0.22, 1.1], 'wood', 'jabez-wilson-pawnshop');
  box([27.8, 0.7, 5.7], [5.0, 0.45, 0.9], 'panel-walnut', 'jabez-wilson-pawnshop');
  box([27.8, 1.22, 5.7], [5.3, 0.12, 1.2], 'wood', 'jabez-wilson-pawnshop');
  for (const x of [25.8, 27.1, 28.4, 29.7]) {
    box([x, 0.7, 6.17], [1.05, 0.64, 0.07], 'wood', 'jabez-wilson-pawnshop');
    box([x, 0.7, 6.22], [0.84, 0.43, 0.035], 'panel-walnut', 'jabez-wilson-pawnshop');
  }
  box([26.2, 1.31, 5.7], [0.83, 0.07, 0.57], 'leather', 'jabez-wilson-pawnshop');
  box([26.2, 1.36, 5.7], [0.76, 0.025, 0.51], 'paper', 'jabez-wilson-pawnshop');
  for (let i = 0; i < 4; i++) box([26.2, 1.377, 5.53 + i * 0.1], [0.6, 0.008, 0.012], 'ink', 'jabez-wilson-pawnshop');
  box([28.6, 1.34, 5.7], [0.7, 0.12, 0.38], 'wood', 'jabez-wilson-pawnshop');
  box([28.6, 1.66, 5.7], [0.065, 0.55, 0.065], 'brass', 'jabez-wilson-pawnshop');
  box([28.6, 1.93, 5.7], [1.18, 0.06, 0.07], 'brass', 'jabez-wilson-pawnshop');
  for (const x of [28.1, 29.1]) {
    box([x, 1.75, 5.7], [0.025, 0.34, 0.025], 'brass', 'jabez-wilson-pawnshop');
    box([x, 1.57, 5.7], [0.35, 0.045, 0.32], 'brass', 'jabez-wilson-pawnshop');
  }
  for (const x of [23.5, 32.2]) {
    for (let z = 4.2; z <= 7.0; z += 1.1) {
      box([x, 1.4, z], [0.35, 2.3, 0.3], 'wood', 'jabez-wilson-pawnshop');
      box([x - 0.18, 0.65, z], [0.75, 0.16, 0.65], 'wood', 'jabez-wilson-pawnshop');
      box([x - 0.18, 1.25, z], [0.75, 0.14, 0.65], 'wood', 'jabez-wilson-pawnshop');
      box([x - 0.18, 1.85, z], [0.75, 0.14, 0.65], 'wood', 'jabez-wilson-pawnshop');
      box([x - 0.18, 0.9, z], [0.34, 0.32, 0.36], 'wood', 'jabez-wilson-pawnshop');
      box([x - 0.18, 1.49, z], [0.32, 0.33, 0.14], 'panel-walnut', 'jabez-wilson-pawnshop');
      box([x - 0.18, 1.49, z + 0.08], [0.23, 0.23, 0.035], 'paper', 'jabez-wilson-pawnshop');
      box([x - 0.18, 1.49, z + 0.105], [0.025, 0.1, 0.02], 'ink', 'jabez-wilson-pawnshop');
      for (let book = 0; book < 3; book++) box([x - 0.4 + book * 0.16, 2.1, z], [0.11, 0.34, 0.27], ['paint-blue', 'paint-red', 'paper'][book], 'jabez-wilson-pawnshop');
      box([x + 0.08, 2.04, z], [0.16, 0.24, 0.17], 'tile-cream', 'jabez-wilson-pawnshop');
    }
  }
  for (let i = 0; i < 5; i++) {
    const z = 4.1 + i * 1.15;
    box([30.5, 1.15, z], [0.62, 1.1, 0.72], 'wood', 'jabez-wilson-pawnshop');
    box([30.5, 1.35, z], [0.42, 0.45, 0.16], 'brass', 'jabez-wilson-pawnshop');
  }
  for (const [x, z] of [[25.2, 4.3], [25.2, 6.2], [29.0, 7.2], [31.0, 7.2]]) {
    box([x, 1.9, z], [0.55, 0.68, 0.12], 'wood', 'jabez-wilson-pawnshop');
    box([x, 1.9, z - 0.09], [0.36, 0.42, 0.07], 'glass-warm', 'jabez-wilson-pawnshop');
    box([x, 2.35, z], [0.62, 0.1, 0.18], 'brass', 'jabez-wilson-pawnshop');
  }
  box([31.2, 0.9, 13.0], [1.1, 0.7, 0.45], 'wood', 'jabez-wilson-pawnshop');
  box([30.8, 1.35, 13.0], [0.42, 0.48, 0.2], 'iron', 'jabez-wilson-pawnshop');
  sign([31.2, 1.95, 13.0], [1.6, 0.46, 0.08], '暗房 · 照相器材', 'jabez-wilson-pawnshop', 0, 'interior');

  // Pawn cellar, its shop stair, and a below-floor trench descending to the bank.
  fillBox(22, -5.0, 3, 34, -4.5, 15, 'earth', 'jabez-wilson-pawnshop', 'interior');
  for (let y = -4.5; y < -0.5; y += unit) {
    fillBox(22, y, 3, 22.5, y + unit, 15, 'brick-soot', 'jabez-wilson-pawnshop', 'interior');
    fillBox(33.5, y, 3, 34, y + unit, 15, 'brick-soot', 'jabez-wilson-pawnshop', 'interior');
    fillBox(22, y, 3, 34, y + unit, 3.5, 'brick-soot', 'jabez-wilson-pawnshop', 'interior');
    fillBox(22, y, 14.5, 34, y + unit, 15, 'brick-soot', 'jabez-wilson-pawnshop', 'interior');
  }
  // Clear the cellar's descending stairwell from the shop floor and build 0.5m risers.
  eraseBox(27, -0.5, 10.5, 32, 0, 12);
  for (let i = 0; i <= 9; i++) {
    const x = 27 + i * 0.5;
    const top = -i * 0.5;
    fillBox(x, top - 0.5, 10.5, x + 0.5, top, 12, 'wood', 'jabez-wilson-pawnshop', 'interior');
  }
  for (const z of [10.15, 12.35]) {
    box([29.25, -0.15, z], [4.8, 0.12, 0.1], 'iron-rust', 'jabez-wilson-pawnshop', 'interior');
  }
  // Cellar storage and the assistant's photographic workbench stay off both paths.
  for (const x of [23.5, 32.0]) {
    box([x, -3.1, 5.1], [0.35, 2.7, 0.35], 'timber', 'jabez-wilson-pawnshop', 'interior');
    for (const y of [-4.05, -3.05, -2.05]) box([x + (x < 28 ? 0.45 : -0.45), y, 5.1], [0.8, 0.12, 3.0], 'wood', 'jabez-wilson-pawnshop', 'interior');
  }
  box([24.6, -3.7, 6.0], [1.6, 0.18, 1.0], 'wood', 'jabez-wilson-pawnshop', 'interior');
  box([24.6, -3.1, 6.0], [0.5, 0.48, 0.42], 'iron', 'jabez-wilson-pawnshop', 'interior');
  box([25.2, -3.12, 6.0], [0.16, 0.22, 0.2], 'glass', 'jabez-wilson-pawnshop', 'interior');
  box([24.3, -4.22, 6.0], [0.42, 0.1, 0.32], 'paper', 'jabez-wilson-pawnshop', 'interior');
  sign([26.5, -2.55, 5.0], [2.8, 0.42, 0.08], '暗房药水与底片', 'jabez-wilson-pawnshop', 0, 'interior');
  lamp([23.3, -2.2, 13.4], [0.28, 0.45, 0.28], 'brass', 'jabez-wilson-pawnshop', 'interior');

  // Underground bank vault: substantial stone walls, a supported ceiling, 30,000 French gold coins.
  fillBox(34, -6.0, 3, 46, -5.5, 15, 'vault-stone', 'city-suburban-bank', 'interior');
  for (let y = -5.5; y < -0.5; y += unit) {
    fillBox(34, y, 3, 34.5, y + unit, 15, 'vault-stone', 'city-suburban-bank', 'interior');
    fillBox(45.5, y, 3, 46, y + unit, 15, 'vault-stone', 'city-suburban-bank', 'interior');
    fillBox(34, y, 3, 46, y + unit, 3.5, 'vault-stone', 'city-suburban-bank', 'interior');
    fillBox(34, y, 14.5, 46, y + unit, 15, 'vault-stone', 'city-suburban-bank', 'interior');
  }
  // Four stone ribs and iron grille leaves frame, but do not obstruct, the vault approach.
  for (const x of [38, 43]) {
    for (const z of [6, 12]) box([x, -2.75, z], [0.45, 5.3, 0.45], 'stone', 'city-suburban-bank', 'interior');
  }
  for (const x of [38.2, 40.2]) {
    box([x, -3.4, 6.4], [0.08, 2.4, 0.08], 'iron', 'city-suburban-bank', 'interior');
    box([x, -2.2, 6.4], [0.1, 0.08, 1.7], 'brass', 'city-suburban-bank', 'interior');
  }
  // Hatch opening in the vault floor: a narrow stair tread remains as a supported exit lip.
  eraseBox(39, -6.0, 8, 44.5, -5.5, 10.5);
  box([40.5, -5.24, 13.2], [1.4, 0.22, 1.5], 'vault-stone', 'city-suburban-bank', 'interior', { rotation: 0.52, solid: false });
  sign([41.8, -4.6, 11.9], [2.6, 0.42, 0.08], '法国金币 · 30,000枚拿破仑', 'city-suburban-bank', 0, 'interior');
  // Fifteen crates, each explicitly marked as 2,000 Napoleons.
  const crateSpots = [
    [42.0, 4.5], [43.4, 4.5], [44.8, 4.5], [42.0, 6.0], [44.8, 6.0],
    [42.0, 12.5], [43.4, 12.5], [44.8, 12.5], [44.8, 7.0], [44.8, 11.0],
    [37.0, 12.5], [38.3, 12.5], [37.0, 4.5], [38.3, 4.5], [44.8, 8.0],
  ];
  crateSpots.forEach(([x, z], i) => {
    const y = i % 4 === 0 ? -4.75 : -5.0;
    box([x, y, z], [1.15, i % 4 === 0 ? 1.5 : 1.0, 1.0], 'wood', 'city-suburban-bank', 'interior');
    box([x, y + 0.32, z - 0.52], [0.7, 0.36, 0.06], 'paper', 'city-suburban-bank', 'interior');
    sign([x, y + 0.32, z - 0.58], [0.62, 0.24, 0.04], '2,000', 'city-suburban-bank', 0, 'interior', 'paper');
    for (let k = 0; k < 3; k++) box([x - 0.25 + k * 0.22, y + 0.58, z + 0.54], [0.13, 0.08, 0.05], 'gold', 'city-suburban-bank', 'interior');
  });
  box([43.7, -4.55, 8.0], [1.1, 0.8, 0.9], 'wood', 'city-suburban-bank', 'interior');
  box([43.7, -4.35, 8.0], [0.85, 0.08, 0.65], 'gold', 'city-suburban-bank', 'interior');
  for (let i = 0; i < 12; i++) box([43.35 + (i % 4) * 0.22, -4.28, 7.78 + Math.floor(i / 4) * 0.2], [0.16, 0.08, 0.13], 'gold', 'city-suburban-bank', 'interior');
  lamp([34.9, -1.5, 14.0], [0.3, 0.5, 0.3], 'brass', 'city-suburban-bank', 'interior');
  lamp([45.0, -1.5, 4.0], [0.3, 0.5, 0.3], 'brass', 'city-suburban-bank', 'interior');

  // The tunnel's 0.5m stepped profile has a 2m clear headway and a 2m clear width.
  // It drops from the pawn cellar, runs below the vault floor on shored earth, then rises at the hatch.
  const tunnelMinX = 27;
  const tunnelMaxX = 44.5;
  const tunnelZ0 = 8;
  const tunnelZ1 = 10;
  const tunnelLevel = (x) => {
    if (x < 33.5) return -4.5 - 0.5 * Math.floor((x - 27) / 1);
    if (x <= 39) return -8;
    return Math.min(-5.5, -8 + 0.5 * Math.floor((x - 39) / 1));
  };
  for (let x = tunnelMinX; x < tunnelMaxX; x += unit) {
    const top = tunnelLevel(x);
    fillBox(x, top - 0.5, tunnelZ0, x + unit, top, tunnelZ1, 'earth', 'tunnel', 'interior');
    for (let z of [tunnelZ0 - unit, tunnelZ1]) {
      fillBox(x, top, z, x + unit, top + 1.5, z + unit, 'earth', 'tunnel', 'interior');
    }
    if (x < 34) fillBox(x, top + 2.5, tunnelZ0, x + unit, top + 3.0, tunnelZ1, 'timber', 'tunnel', 'interior');
  }
  // Carve a real opening through the cellar's earthen floor where the tunnel begins.
  eraseBox(27, -5.0, 8, 34, -4.5, 10);
  // Rebuild tunnel treads after the floor cut; the ramp and its sidewalls remain continuous.
  for (let x = tunnelMinX; x < tunnelMaxX; x += unit) {
    const top = tunnelLevel(x);
    fillBox(x, top - 0.5, tunnelZ0, x + unit, top, tunnelZ1, 'earth', 'tunnel', 'interior');
  }
  // Heavy oak frames support the dug section every meter; lamps and tools sit in wall recesses.
  for (const x of [34.5, 36]) {
    const top = tunnelLevel(x);
    for (const z of [8.08, 9.92]) box([x, top + 0.82, z], [0.15, 1.6, 0.15], 'timber', 'tunnel', 'interior');
    box([x, top + 2.08, 9.0], [1.0, 0.15, 1.95], 'timber', 'tunnel', 'interior');
  }
  for (const x of [31.3, 35.3, 38.3]) {
    const top = tunnelLevel(x);
    lamp([x, top + 1.05, 8.2], [0.22, 0.36, 0.22], 'brass', 'tunnel', 'interior');
  }
  box([35.5, -6.95, 8.15], [0.72, 0.14, 0.3], 'iron', 'tunnel', 'interior');
  box([36.3, -6.85, 8.12], [0.18, 0.38, 0.18], 'wood', 'tunnel', 'interior');
  box([36.7, -6.75, 8.3], [0.48, 0.12, 0.12], 'iron', 'tunnel', 'interior');
  box([37.4, -6.82, 9.78], [0.75, 0.12, 0.3], 'wood', 'tunnel', 'interior');
  sign([34.5, -7.0, 9.0], [1.5, 0.34, 0.06], '向银行金库', 'tunnel', Math.PI / 2, 'interior');

  // Shop and bank stairs are actual 0.5m voxel treads, with clear width and open headroom.
  // Open the bank stairwell in the main hall/vault ceiling, then descend eleven half-meter steps.
  eraseBox(35, -0.5, 4, 37, 0, 14.5);
  eraseBox(35, -6, 4, 37, -5.5, 14.5);
  for (let i = 0; i <= 11; i++) {
    if (i === 11) continue;
    const z = 4 + i;
    const top = -i * 0.5;
    const depth = i === 10 ? 0.5 : 1;
    fillBox(35, top - 0.5, z, 37, top, z + depth, 'stone', 'city-suburban-bank', 'interior');
  }
  for (const x of [34.78, 37.22]) box([x, -1.0, 9.25], [0.12, 2.0, 10.5], 'iron-rust', 'city-suburban-bank', 'interior');
  // Cellar stair runs down nine half-meter risers; its centerline remains clear at 1.5m width.

  // Private sitting room on the first floor of 221B: green paper, dark paneling and Holmes's clutter.
  // The upper-floor stair opening is cut before furnishing the room.
  eraseBox(-43.25, 2.5, -33.0, -41.75, 3, -29.5);
  for (let i = 0; i <= 6; i++) {
    const z = -33 + i * 0.5;
    const top = 3 - i * 0.5;
    fillBox(-43.25, top - 0.5, z, -41.75, top, z + 0.5, 'wood', 'baker-221b', 'interior');
  }
  // Inner wall treatments sit just inside the outer shell, leaving the stair and door aisles open.
  for (let z = -33.5; z < -24; z += 1.5) {
    if (Math.abs(z + 29) < 1.5) continue;
    box([-45.18, 3.5, z], [0.12, 1.0, 1.35], 'panel-walnut', 'baker-221b', 'interior');
    box([-45.10, 4.75, z], [0.08, 1.5, 1.35], 'wallpaper-green', 'baker-221b', 'interior');
    box([-34.82, 3.5, z], [0.12, 1.0, 1.35], 'panel-walnut', 'baker-221b', 'interior');
    box([-34.9, 4.75, z], [0.08, 1.5, 1.35], 'wallpaper-green', 'baker-221b', 'interior');
  }
  box([-40.0, 3.5, -34.4], [8.8, 1.0, 0.12], 'panel-walnut', 'baker-221b', 'interior');
  box([-40.0, 4.75, -34.38], [8.8, 1.5, 0.08], 'wallpaper-green', 'baker-221b', 'interior');
  box([-40.0, 3.5, -23.62], [8.8, 1.0, 0.12], 'panel-walnut', 'baker-221b', 'interior');
  box([-40.0, 4.75, -23.65], [8.8, 1.5, 0.08], 'wallpaper-green', 'baker-221b', 'interior');
  box([-39.5, 2.96, -29.0], [3.5, 0.08, 2.0], 'rug-red', 'baker-221b', 'interior');
  // A black firebox opens toward the room beneath a broad walnut mantel.
  box([-35.38, 3.06, -31.4], [0.9, 0.12, 2.25], 'stone', 'baker-221b');
  box([-35.42, 3.65, -31.4], [0.1, 1.06, 1.5], 'paint-black', 'baker-221b');
  for (const z of [-32.28, -30.52]) box([-35.37, 3.68, z], [0.52, 1.28, 0.27], 'brick-soot', 'baker-221b');
  box([-35.43, 4.31, -31.4], [0.75, 0.17, 2.35], 'panel-walnut', 'baker-221b');
  box([-35.53, 3.19, -31.4], [0.24, 0.13, 1.05], 'coal', 'baker-221b');
  for (const [z, height] of [[-31.78, 0.23], [-31.4, 0.4], [-31.07, 0.29]]) {
    box([-35.55, 3.25 + height / 2, z], [0.12, height, 0.22], 'fire-orange', 'baker-221b', 'interior', { emissive: true });
    box([-35.62, 3.26 + height / 3, z], [0.06, height * 0.65, 0.1], 'fire-gold', 'baker-221b', 'interior', { emissive: true });
  }
  box([-35.4, 4.58, -31.4], [0.25, 0.38, 0.4], 'wood', 'baker-221b');
  box([-35.55, 4.58, -31.4], [0.05, 0.26, 0.27], 'brass', 'baker-221b');
  // Upholstered chairs have separate seats, backs, arms and exposed feet.
  for (const [x, z] of [[-44, -28.1], [-37.5, -30.8]]) {
    box([x, 3.36, z], [1.26, 0.13, 1.14], 'panel-walnut', 'baker-221b');
    box([x, 3.53, z], [1.16, 0.22, 1.05], 'leather', 'baker-221b');
    box([x, 4.0, z - 0.46], [1.22, 0.92, 0.22], 'leather', 'baker-221b');
    for (const dx of [-0.6, 0.6]) box([x + dx, 3.74, z], [0.16, 0.4, 1.1], 'leather', 'baker-221b');
    for (const dx of [-0.51, 0.51]) for (const dz of [-0.43, 0.43]) box([x + dx, 3.16, z + dz], [0.1, 0.32, 0.1], 'wood', 'baker-221b');
  }
  // Tea table: a thin top, four legs, folded newspaper, cup and saucer.
  box([-40.1, 3.82, -29.1], [2.2, 0.12, 1.34], 'panel-walnut', 'baker-221b');
  for (const dx of [-0.88, 0.88]) for (const dz of [-0.47, 0.47]) box([-40.1 + dx, 3.39, -29.1 + dz], [0.11, 0.78, 0.11], 'wood', 'baker-221b');
  box([-40.55, 3.91, -29.0], [0.58, 0.04, 0.38], 'paper', 'baker-221b', 'interior', { rotation: 0.12 });
  box([-39.75, 3.91, -29.2], [0.35, 0.035, 0.35], 'paper', 'baker-221b');
  box([-39.75, 4.0, -29.2], [0.18, 0.16, 0.18], 'brass', 'baker-221b');
  box([-39.62, 4.0, -29.2], [0.09, 0.08, 0.06], 'brass', 'baker-221b');
  box([-40, 3.35, -26], [3.5, 0.13, 1.05], 'wood', 'baker-221b');
  for (const dx of [-1.1, 0, 1.1]) box([-40 + dx, 3.54, -26], [1.04, 0.23, 0.98], 'velvet-red', 'baker-221b');
  box([-40, 4.03, -26.45], [3.55, 0.95, 0.22], 'velvet-red', 'baker-221b');
  for (const dx of [-1.7, 1.7]) box([-40 + dx, 3.77, -26], [0.17, 0.45, 1.08], 'velvet-red', 'baker-221b');
  for (const dx of [-1.5, 1.5]) for (const dz of [-0.4, 0.4]) box([-40 + dx, 3.16, -26 + dz], [0.1, 0.32, 0.1], 'wood', 'baker-221b');
  for (const center of [-32.75, -25.75]) {
    for (const side of [-0.67, 0.67]) {
      box([-45.02, 4.52, center + side], [0.18, 1.65, 0.32], 'curtain-gold', 'baker-221b', 'interior', { solid: false });
      box([-44.9, 4.35, center + side], [0.08, 0.08, 0.36], 'brass', 'baker-221b', 'interior', { solid: false });
    }
    box([-45.0, 5.34, center], [0.1, 0.1, 1.85], 'wood', 'baker-221b', 'interior', { solid: false });
  }
  // Tall bookcases, books, Holmes's writing desk, violin, and chemistry glassware.
  for (const z of [-33.0, -24.5]) {
    box([-44.8, 4.35, z], [0.42, 2.45, 2.0], 'panel-walnut', 'baker-221b', 'interior');
    for (const y of [3.55, 4.15, 4.75, 5.35]) {
      box([-44.52, y, z], [0.18, 0.08, 1.85], 'wood', 'baker-221b', 'interior');
      for (let i = 0; i < 5; i++) box([-44.4, y + 0.2, z - 0.72 + i * 0.34], [0.16, 0.34, 0.22], ['paint-red', 'paint-green', 'paint-blue', 'paper', 'leather'][i], 'baker-221b', 'interior');
    }
  }
  for (const dx of [-1.06, 1.06]) for (const dz of [-0.43, 0.43]) box([-37 + dx, 3.47, -25 + dz], [0.12, 0.94, 0.12], 'wood', 'baker-221b');
  box([-37, 3.8, -25], [2.5, 0.18, 0.94], 'wood', 'baker-221b');
  box([-37.0, 3.98, -25.0], [2.75, 0.12, 1.3], 'panel-walnut', 'baker-221b', 'interior');
  box([-37.4, 4.2, -25.05], [0.8, 0.05, 0.62], 'paper', 'baker-221b', 'interior');
  box([-36.1, 4.2, -25.0], [0.25, 0.05, 0.28], 'ink', 'baker-221b', 'interior');
  box([-36.8, 4.3, -25.05], [0.48, 0.08, 0.06], 'wood', 'baker-221b', 'interior', { rotation: -0.3 });
  box([-36.2, 3.5, -27.5], [0.1, 0.12, 0.8], 'wood', 'baker-221b', 'interior', { rotation: 0.3 });
  box([-36.2, 3.68, -27.5], [0.08, 0.32, 0.08], 'wood', 'baker-221b', 'interior');
  box([-35.9, 3.78, -27.5], [0.38, 0.06, 0.06], 'wood', 'baker-221b', 'interior');
  box([-43.1, 3.7, -26.8], [0.55, 0.52, 0.42], 'glass', 'baker-221b', 'interior');
  box([-43.1, 4.0, -26.8], [0.2, 0.22, 0.18], 'glass-warm', 'baker-221b', 'interior');
  box([-42.5, 3.6, -26.8], [0.32, 0.42, 0.3], 'copper', 'baker-221b', 'interior');
  box([-42.2, 3.52, -26.8], [0.18, 0.14, 0.18], 'paper', 'baker-221b', 'interior');
  // Wall clock, three paintings, and a warm shaded gas lamp.
  box([-45.05, 5.05, -27.0], [0.18, 0.92, 0.82], 'wood', 'baker-221b', 'interior');
  box([-44.92, 5.05, -27.0], [0.06, 0.58, 0.5], 'brass', 'baker-221b', 'interior');
  for (const [x, z, color] of [[-45.0, -31.0, 'paint-blue'], [-45.0, -28.0, 'paint-green'], [-35.0, -25.0, 'paint-red']]) {
    box([x, 5.15, z], [0.12, 1.1, 1.25], 'wood', 'baker-221b', 'interior');
    box([x + (x < -40 ? 0.08 : -0.08), 5.15, z], [0.08, 0.88, 1.02], color, 'baker-221b', 'interior');
  }
  lamp([-40.0, 5.35, -30.0], [0.3, 0.48, 0.3], 'brass', 'baker-221b', 'interior');

  // League office: one deal table, two chairs, volume A, ink, paper and the closure card.
  box([-10.2, 0.82, -32.5], [3.1, 0.18, 1.35], 'wood', 'pope-court-no7');
  box([-10.2, 0.48, -32.5], [2.9, 0.48, 1.25], 'panel-walnut', 'pope-court-no7');
  for (const z of [-33.7, -31.2]) {
    box([-10.2, 0.46, z], [0.92, 0.18, 0.86], 'wood', 'pope-court-no7');
    box([-10.2, 0.92, z + 0.3], [0.82, 0.82, 0.16], 'wood', 'pope-court-no7');
  }
  box([-10.9, 0.97, -32.4], [0.72, 0.18, 0.92], 'paper', 'pope-court-no7');
  box([-9.65, 0.98, -32.25], [0.52, 0.08, 0.38], 'paper', 'pope-court-no7');
  box([-9.05, 1.03, -32.6], [0.18, 0.18, 0.18], 'ink', 'pope-court-no7');
  box([-8.75, 1.05, -32.6], [0.08, 0.34, 0.05], 'wood', 'pope-court-no7', 'interior', { rotation: 0.5 });
  box([-12.2, 1.0, -35.5], [0.82, 1.15, 0.6], 'paper', 'pope-court-no7');
  sign([-12.2, 1.05, -35.12], [0.58, 0.72, 0.06], 'A', 'pope-court-no7', 0, 'interior', 'paper');
  lamp([-6.4, 2.05, -35.6], [0.24, 0.42, 0.24], 'brass', 'pope-court-no7', 'interior');

  // Gas lamps, street signs, drain details and an empty hansom on the commercial approach.
  for (const [x, z] of [[-53, -41], [-46, -26], [-14, -17], [10, -41], [48, -37], [48, -18], [48, 4], [48, 22], [57, 34]]) {
    box([x, 2.0, z], [0.18, 4.0, 0.18], 'iron', 'london-streets', 'exterior');
    box([x, 3.95, z], [0.58, 0.16, 0.58], 'iron', 'london-streets', 'exterior');
    lamp([x, 4.35, z], [0.5, 0.7, 0.5], 'brass', 'london-streets');
  }
  sign([53.2, 3.0, -18.4], [5.0, 0.65, 0.08], '科堡广场 →   城市与郊区银行', 'city-cross-street', 0, 'exterior');
  sign([-13.3, 2.8, -16.2], [4.4, 0.6, 0.08], '蒲柏巷 ←', 'city-cross-street', Math.PI / 2, 'exterior');
  sign([49.0, 3.1, -35.5], [4.2, 0.68, 0.08], '17 · KING EDWARD ST', 'king-edward-kneecap-factory', Math.PI / 2, 'exterior');
  // One parked hansom with a clear roadway centerline.
  box([55.2, 0.95, 0.0], [2.2, 1.0, 1.3], 'wood', 'commercial-street', 'exterior');
  box([55.2, 1.55, 0.05], [1.6, 0.45, 1.1], 'paint-black', 'commercial-street', 'exterior');
  for (const [x, z] of [[54.25, -0.75], [56.15, -0.75], [54.25, 0.75], [56.15, 0.75]]) box([x, 0.48, z], [0.42, 0.42, 0.22], 'iron', 'commercial-street', 'exterior');
  box([52.7, 0.95, -0.25], [0.4, 0.7, 0.42], 'leather', 'commercial-street', 'exterior');
  box([52.7, 1.45, -0.25], [0.34, 0.36, 0.34], 'leather', 'commercial-street', 'exterior');

  const addPlace = (id, name, subtitle, position, entry, bounds, cameraPosition, cameraTarget, interior, clipHeight, site = id) => ({
    id, name, subtitle, position, entry, bounds,
    camera: { position: cameraPosition, target: cameraTarget },
    interior,
    ...(clipHeight === undefined ? {} : { clipHeight }),
    site,
  });
  const places = [
    addPlace('baker-street', '贝克街 · 221B', '烟熏砖墙与煤气灯下的伦敦街面', [-50, 0, -29], [-46.5, 0, -29], { min: [-56, -0.5, -40], max: [-45, 8, -16] }, [-52.5, 6, -21], [-45.5, 2.5, -29], false, undefined, 'baker-street'),
    addPlace('sitting-room', '221B 起居室', '绿墙纸、壁炉、茶桌与散落的案件笔记', [-43, 3, -27.3], [-42.5, 3, -32.75], { min: [-45.5, 2.5, -34.5], max: [-34.5, 9, -23.5] }, [-34, 7, -28], [-40, 4, -29], true, 4.8, 'baker-221b'),
    addPlace('fleet-street', '舰队街', '马车、煤气灯与报馆招牌交织的商路', [0, 0, -44], [0, 0, -44], { min: [-60, -0.5, -50], max: [60, 6, -39] }, [-4, 5, -45], [-15, 2, -37], false, undefined, 'fleet-street'),
    addPlace('pope-court', '蒲柏巷', '舰队街后侧的窄巷；申请日曾挤满红发人群', [-13.5, 0, -40], [-6.5, 0, -41], { min: [-16, -0.5, -42], max: [-5, 6, -25] }, [-7, 3.5, -42], [-10, 1.4, -36.5], false, undefined, 'pope-court'),
    addPlace('league-office', '红发会办公室 · 7号', '十点到两点抄写《大英百科全书》；周薪 £4', [-13, 0, -34.5], [-10, 0, -36.5], { min: [-14.5, -0.5, -37], max: [-5.5, 7, -27.5] }, [-5, 5, -31], [-10, 1, -33], true, 2.35, 'pope-court-no7'),
    addPlace('coburg-square', '科堡广场', '四排两层旧砖屋围住荒草与几簇月桂', [10.5, 0, 10.5], [-1, 0, 9], { min: [-14, -0.5, -12], max: [34, 10, 32] }, [7, 6.8, 21], [23, 2.2, 9], false, undefined, 'coburg-square'),
    addPlace('pawnshop', '威尔逊当铺', '三枚金球招牌；柜台、旧钟与暗房入口', [25, 0, 9], [22.5, 0, 9], { min: [22, -0.5, 3], max: [34, 8, 15] }, [33, 7, 10], [28, 1, 9], true, 2.35, 'jabez-wilson-pawnshop'),
    addPlace('pawn-cellar', '当铺地窖', 'Spaulding 的暗房与掘进起点', [28, -4.5, 6.5], [31.75, -4.5, 11.25], { min: [22, -8.5, 3], max: [34, 0, 15] }, [33, -1.5, 10], [28, -4.5, 8], true, -2.7, 'jabez-wilson-pawnshop'),
    addPlace('tunnel', '地道', '木撑、泥土、工具与灯火；通向金库石板下方', [36.5, -8, 9], [27.25, -4.5, 9], { min: [27, -9, 7.5], max: [41.5, -2.5, 10.5] }, [36, -4, 13], [36, -7.5, 9], true, -5.1, 'tunnel'),
    addPlace('commercial-street', '繁忙商业街', '烟草店、报摊、银行、素食馆与马车厂依次相邻', [52, 0, 10], [52, 0, -18], { min: [46, -0.5, -20], max: [60, 8, 36] }, [60, 12, 22], [50, 0, 8], false, undefined, 'commercial-street'),
    addPlace('mortimer-tobacconist', '莫蒂默烟草店', '烟斗、雪茄与鼻烟陈列在深色木架上', [42, 0, -7], [46, 0, -9], { min: [34, -0.5, -13], max: [46, 8, -5] }, [48, 6, -8], [40, 1, -9], true, 2.35, 'mortimers-tobacconist'),
    addPlace('newspaper-shop', '小报摊', '《晨报纪事》与折叠报纸', [40, 0, 1.8], [46, 0, -1], { min: [34, -0.5, -5], max: [46, 8, 3] }, [48, 6, 1], [40, 1, -1], true, 2.35, 'city-newspaper-shop'),
    addPlace('bank', '城市与郊区银行', '临街大厅、柜台与通往地下石阶的入口', [42, 0, 11.5], [46, 0, 9], { min: [34, -0.5, 3], max: [46, 8, 15] }, [48, 8, 12], [40, 1, 9], true, 2.35, 'city-suburban-bank'),
    addPlace('bank-vault', '地下金库', '石拱与箱堆中存放着30,000枚法国拿破仑金币', [41.5, -5.5, 11], [37.25, -5.5, 14.25], { min: [34, -6.5, 3], max: [46, 0.5, 15] }, [45, 1, 17], [41, -3.5, 9], true, -3.7, 'city-suburban-bank'),
    addPlace('restaurant', '素食餐馆', '热汤、蔬菜与几张紧凑的餐桌', [42.5, 0, 21], [46, 0, 19], { min: [34, -0.5, 15], max: [46, 8, 23] }, [48, 6, 22], [40, 1, 19], true, 2.35, 'vegetarian-restaurant'),
    addPlace('carriage-depot', '麦克法兰马车厂', '街区商路尽头的车厢与轮轴工坊', [44.5, 0, 31], [46, 0, 28], { min: [34, -0.5, 23], max: [46, 8, 33] }, [48, 7, 31], [40, 1, 28], true, 2.35, 'mcfarlanes-carriage-depot'),
    addPlace('music-hall', '圣詹姆斯音乐厅', '萨拉萨泰登台；中央走道贯穿红绒座席', [13.95, 0, -32.8], [14, 0, -27.5], { min: [6, -0.5, -38], max: [22, 9, -27] }, [25, 10, -25], [14, 1, -32], true, 2.35, 'st-jamess-hall'),
    addPlace('king-edward', '国王爱德华街 · 17号', '人工膝盖护具厂门面；威廉·莫里斯的假地址', [43, 0, -26.5], [47, 0, -26.5], { min: [38, -0.5, -32], max: [48, 9, -21] }, [55, 5.5, -24], [47, 2, -26.5], false, undefined, 'king-edward-kneecap-factory'),
    addPlace('knee-cap-factory', '人工膝盖护具厂', '工人从未听说过威廉·莫里斯或邓肯·罗斯', [41.5, 0, -25], [47, 0, -26.5], { min: [38, -0.5, -32], max: [47, 8, -21] }, [50, 7, -23], [42, 1, -26], true, 2.35, 'king-edward-kneecap-factory'),
  ];

  const routes = [
    { id: 'baker-to-sitting-room', from: 'baker-street', to: 'sitting-room', mode: 'stairs', points: [[-46.5, 0, -29], [-44, 0, -29], [-41, 0, -29], [-42.5, 0, -29.75], [-42.5, 0.5, -30.25], [-42.5, 1, -30.75], [-42.5, 1.5, -31.25], [-42.5, 2, -31.75], [-42.5, 2.5, -32.25], [-42.5, 3, -32.75]] },
    { id: 'baker-to-fleet-street', from: 'baker-street', to: 'fleet-street', mode: 'street', points: [[-50, 0, -29], [-50, 0, -39], [-50, 0, -48], [-35, 0, -48], [-18, 0, -48], [0, 0, -48]] },
    { id: 'fleet-to-pope-court', from: 'fleet-street', to: 'pope-court', mode: 'street', points: [[-10, 0, -44], [-7, 0, -44], [-6.5, 0, -41], [-6.5, 0, -38]] },
    { id: 'pope-court-to-office', from: 'pope-court', to: 'league-office', mode: 'street', points: [[-6.5, 0, -41], [-6.5, 0, -38], [-8, 0, -38], [-10, 0, -38], [-10, 0, -36.5]] },
    { id: 'fleet-to-music-hall', from: 'fleet-street', to: 'music-hall', mode: 'street', points: [[14, 0, -44], [23, 0, -44], [23, 0, -31], [23, 0, -26.5], [14, 0, -26.5], [14, 0, -27.5]] },
    { id: 'fleet-to-king-edward', from: 'fleet-street', to: 'king-edward', mode: 'street', points: [[52, 0, -44], [52, 0, -34], [52, 0, -26.5], [47, 0, -26.5]] },
    { id: 'fleet-to-commercial', from: 'fleet-street', to: 'commercial-street', mode: 'street', points: [[52, 0, -44], [52, 0, -30], [52, 0, -18]] },
    { id: 'square-to-commercial', from: 'coburg-square', to: 'commercial-street', mode: 'street', points: [[10, 0, 10], [-1, 0, 10], [-10, 0, 10], [-10, 0, 0], [-10, 0, -10], [-10, 0, -17], [0, 0, -17], [23, 0, -17], [46, 0, -17], [52, 0, -17], [52, 0, -18]] },
    { id: 'square-to-pawnshop', from: 'coburg-square', to: 'pawnshop', mode: 'street', points: [[20.5, 0, 9], [22, 0, 9], [22.5, 0, 9], [25, 0, 9]] },
    { id: 'pawnshop-to-cellar', from: 'pawnshop', to: 'pawn-cellar', mode: 'stairs', points: [[25, 0, 9], [26.5, 0, 9], [26.5, 0, 11.25], [27.25, 0, 11.25], [27.75, -0.5, 11.25], [28.25, -1, 11.25], [28.75, -1.5, 11.25], [29.25, -2, 11.25], [29.75, -2.5, 11.25], [30.25, -3, 11.25], [30.75, -3.5, 11.25], [31.25, -4, 11.25], [31.75, -4.5, 11.25]] },
    { id: 'cellar-to-tunnel', from: 'pawn-cellar', to: 'tunnel', mode: 'tunnel', points: [[31.75, -4.5, 11.25], [32.5, -4.5, 11.25], [32.5, -4.5, 12.75], [26.5, -4.5, 12.75], [26.5, -4.5, 11.25], [26.5, -4.5, 9], [27.25, -4.5, 9], [27.75, -4.5, 9], [28.25, -5, 9], [29.25, -5.5, 9], [30.25, -6, 9], [31.25, -6.5, 9], [32.25, -7, 9], [33.25, -7.5, 9], [33.75, -8, 9], [34.25, -8, 9], [35.5, -8, 9], [36.25, -8, 9]] },
    { id: 'tunnel-to-vault', from: 'tunnel', to: 'bank-vault', mode: 'tunnel', points: [[36.25, -8, 9], [36.75, -8, 9], [37.25, -8, 9], [37.75, -8, 9], [38.25, -8, 9], [38.75, -8, 9], [39.25, -8, 9], [39.75, -8, 9], [40.25, -7.5, 9], [40.75, -7.5, 9], [41.25, -7, 9], [41.75, -7, 9], [42.25, -6.5, 9], [42.75, -6.5, 9], [43.25, -6, 9], [43.75, -6, 9], [44.25, -5.5, 9], [44.75, -5.5, 9]] },
    { id: 'commercial-to-bank', from: 'commercial-street', to: 'bank', mode: 'street', points: [[52, 0, 10], [49, 0, 10], [46.5, 0, 9], [45, 0, 9]] },
    { id: 'bank-to-vault-stairs', from: 'bank', to: 'bank-vault', mode: 'stairs', points: [[45, 0, 9], [45, 0, 10.5], [44, 0, 11.5], [40, 0, 11.5], [38, 0, 11.5], [37.75, 0, 11.5], [37.75, 0, 9], [37.75, 0, 6], [37.75, 0, 4.5], [36, 0, 4.5], [36, -0.5, 5.5], [36, -1, 6.5], [36, -1.5, 7.5], [36, -2, 8.5], [36, -2.5, 9.5], [36, -3, 10.5], [36, -3.5, 11.5], [36, -4, 12.5], [36, -4.5, 13.5], [36, -5, 14.25], [37.25, -5.5, 14.25], [38, -5.5, 13.5], [40, -5.5, 13.5], [42, -5.5, 13.5]] },
    { id: 'commercial-to-mortimer', from: 'commercial-street', to: 'mortimer-tobacconist', mode: 'street', points: [[52, 0, -9], [49, 0, -9], [46.5, 0, -9], [44.5, 0, -9]] },
    { id: 'commercial-to-newspaper', from: 'commercial-street', to: 'newspaper-shop', mode: 'street', points: [[52, 0, -1], [49, 0, -1], [46.5, 0, -1], [44.5, 0, -1]] },
    { id: 'commercial-to-restaurant', from: 'commercial-street', to: 'restaurant', mode: 'street', points: [[52, 0, 19], [49, 0, 19], [46.5, 0, 19], [44.5, 0, 19]] },
    { id: 'commercial-to-carriage-depot', from: 'commercial-street', to: 'carriage-depot', mode: 'street', points: [[52, 0, 28], [49, 0, 28], [46.5, 0, 28], [44.5, 0, 28]] },
    { id: 'commercial-to-knee-factory', from: 'commercial-street', to: 'knee-cap-factory', mode: 'street', points: [[52, 0, -18], [52, 0, -26.5], [47, 0, -26.5], [44.5, 0, -26.5]] },
  ];

  const chapters = [
    { id: 'league', name: '红发会', time: '10:00' },
    { id: 'investigation', name: '调查', time: '14:00' },
    { id: 'heist', name: '银行之夜', time: '23:00' },
    { id: 'aftermath', name: '破案之后', time: '00:30' },
  ];
  const residents = [
    {
      id: 'sherlock-holmes', name: '福尔摩斯', role: '顾问侦探', coat: '#252a2d', hair: '#342c28',
      states: {
        league: { position: [-44, 3, -27], placeId: 'sitting-room' },
        investigation: { position: [10, 0, 10], placeId: 'coburg-square' },
        heist: { position: [42, -5.5, 7.0], placeId: 'bank-vault' },
        aftermath: { position: [-42.5, 3, -27.3], placeId: 'sitting-room' },
      },
    },
    {
      id: 'dr-watson', name: '华生', role: '医生与叙述者', coat: '#5c625d', hair: '#5c4a3a',
      states: {
        league: { position: [-41.5, 3, -27.2], placeId: 'sitting-room' },
        investigation: { position: [12, 0, 12], placeId: 'coburg-square' },
        heist: { position: [41.5, -5.5, 11.5], placeId: 'bank-vault' },
        aftermath: { position: [-38.5, 3, -27.2], placeId: 'sitting-room' },
      },
    },
    {
      id: 'jabez-wilson', name: '威尔逊', role: '红发典当商', coat: '#554b40', hair: '#d25e24',
      states: {
        league: { position: [-12.5, 0, -33.5], placeId: 'league-office' },
        investigation: { position: [24.5, 0, 9.2], placeId: 'pawnshop' },
        heist: { position: [25, 0, 9], placeId: 'pawnshop' },
        aftermath: { position: [25.0, 0, 9.4], placeId: 'pawnshop' },
      },
    },
    {
      id: 'john-clay-spaulding', name: '斯波尔丁', role: '当铺伙计', coat: '#292e31', hair: '#44382d',
      states: {
        league: { position: [29.5, 0, 9.0], placeId: 'pawnshop' },
        investigation: { position: [25.5, 0, 8.5], placeId: 'pawnshop' },
        heist: { position: [40.25, -7.5, 9.0], placeId: 'tunnel' },
        aftermath: { position: [20.5, 0, 12], placeId: 'coburg-square' },
      },
    },
    {
      id: 'archie-duncan-ross', name: '罗斯', role: '红发会经理', coat: '#7b3c32', hair: '#d94f2c',
      states: {
        league: { position: [-7, 0, -34.5], placeId: 'league-office' },
        heist: { position: [33.25, -7.5, 9.0], placeId: 'tunnel' },
        aftermath: { position: [52, 0, -18], placeId: 'commercial-street' },
      },
    },
    {
      id: 'peter-jones', name: '琼斯', role: '苏格兰场警探', coat: '#5c5145', hair: '#4a4038',
      states: {
        league: { position: [2, 0, -44], placeId: 'fleet-street' },
        investigation: { position: [5, 0, -44], placeId: 'fleet-street' },
        heist: { position: [40.5, -5.5, 5.5], placeId: 'bank-vault' },
        aftermath: { position: [51.5, 0, -17], placeId: 'commercial-street' },
      },
    },
    {
      id: 'mr-merryweather', name: '梅里韦瑟', role: '银行董事长', coat: '#514c46', hair: '#8a8170',
      states: {
        league: { position: [42.5, 0, 11], placeId: 'bank' },
        investigation: { position: [42.5, 0, 11], placeId: 'bank' },
        heist: { position: [41, -5.5, 12], placeId: 'bank-vault' },
        aftermath: { position: [42.5, 0, 11], placeId: 'bank' },
      },
    },
  ];

  return {
    id: 'red-headed-league',
    title: '红发会',
    unit,
    cells: Array.from(cellsByPosition.values()),
    props,
    places,
    routes,
    residents,
    chapters,
    overview: { position: [62, 52, 70], target: [0, 0, -8] },
    materials,
  };
}
