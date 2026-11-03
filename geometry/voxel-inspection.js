const key = p => p.join(',');
const within = (p, o) => p.every((n, i) => n >= o.from[i] && n <= o.to[i]);
const solid = material => material !== undefined && material !== 'water';

// Deliberately limited to the current single-level rectangular building contract:
// from.y is the floor. Findings are advisory during incremental construction.
// No visual judgement, arbitrary geometry, stairs or physics is inferred here.
export function inspectVoxelSpaces(world) {
  const objects = world?.objects || [], cells = new Map((world?.cells || []).map(c => [key(c.position), c.material]));
  const issues = [], buildings = [];
  const add = (object, code, message, repairHint = null, repair = null) => issues.push({ objectId: object.id, code, message: `${object.name}：${message}`, ...(repairHint ? { repairHint } : {}), ...(repair ? { repair } : {}) });
  const read = (x, y, z) => cells.get(`${x},${y},${z}`);
  const standing = (x, floor, z) => solid(read(x, floor, z)) && !read(x, floor + 1, z) && !read(x, floor + 2, z);
  const roofs = objects.filter(o => o.kind === 'roof');
  const roofCells = new Set();
  for (const roof of roofs) {
    // A legacy roof-colored voxel is explicit; arbitrary wood in a legacy box is not.
    const positions = roof.members ?? (world.cells || []).filter(c => c.material === 'roof' && within(c.position, roof)).map(c => c.position);
    for (const p of positions) if (solid(cells.get(key(p)))) roofCells.add(key(p));
  }
  for (const object of objects.filter(o => o.kind === 'building')) {
    const [x0, floor, z0] = object.from, [x1, top, z1] = object.to;
    const area = (x1 - x0 + 3) * (z1 - z0 + 3);
    if (x1 - x0 < 2 || z1 - z0 < 2 || top - floor < 3 || area * (top - floor + 1) > 32768) {
      add(object, 'unsupported-building', '当前范围不适合单层矩形建筑检查，尚未验证可进入空间。');
      continue;
    }
    let walkableCells = 0, entrances = 0, roofGaps = 0, wallGaps = 0, floorGaps = 0, doorHint = null;
    for (let x = x0 + 1; x < x1; x++) for (let z = z0 + 1; z < z1; z++) {
      if (!solid(read(x, floor, z))) floorGaps++;
      if (standing(x, floor, z)) walkableCells++;
      let covered = false;
      for (let y = floor + 3; y <= top + 1; y++) if (roofCells.has(`${x},${y},${z}`)) { covered = true; break; }
      if (!covered) roofGaps++;
    }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue;
      if (!solid(read(x, floor + 3, z))) wallGaps++;
      const direction = x === x0 && z > z0 && z < z1 ? [-1, 0] : x === x1 && z > z0 && z < z1 ? [1, 0]
        : z === z0 && x > x0 && x < x1 ? [0, -1] : z === z1 && x > x0 && x < x1 ? [0, 1] : null;
      if (direction && standing(x, floor, z) && standing(x + direction[0], floor, z + direction[1]) &&
          standing(x - direction[0], floor, z - direction[1])) entrances++;
      if (direction && !doorHint) {
        const outside = [x + direction[0], floor, z + direction[1]];
        const opening = !solid(read(x, floor + 1, z)) && !solid(read(x, floor + 2, z));
        if (opening || !solid(read(...outside))) doorHint = { from: [x, floor + 1, z], to: [x, floor + 2, z], outside };
      }
    }
    if (!walkableCells) add(object, 'no-headroom', '没有同时具备地板和两格净空的室内位置，请先清出可站立空间。');
    if (!entrances) add(object, 'no-entrance', '没有检测到连接室内与室外地面的两格高门洞；门洞外侧还必须有一格实心地面（例如 grass），并且门洞上方两格保持为空气。',
      doorHint ? `请分成两个操作：清出门洞 ${JSON.stringify(doorHint.from)} 到 ${JSON.stringify(doorHint.to)}，该操作带 objectId ${object.id}；再在外侧 ${JSON.stringify(doorHint.outside)} 补一格 grass，该操作不要带 objectId，因为它位于建筑范围外。不要把门外地面登记为建筑成员。` : null,
      doorHint ? { type: 'entrance', objectId: object.id, door: { from: doorHint.from, to: doorHint.to }, outside: doorHint.outside } : null);
    if (floorGaps) add(object, 'floor-gap', `室内有 ${floorGaps} 处缺少实心地板。`);
    if (wallGaps) add(object, 'wall-gap', `墙顶高度有 ${wallGaps} 处开口，请检查墙体与屋顶衔接。`);
    if (roofGaps) add(object, 'roof-gap', `有 ${roofGaps} 列室内范围没有可确认的屋顶覆盖。`);
    if ((world.cells || []).some(c => c.material === 'water' && within(c.position, object))) add(object, 'water-inside', '水与建筑范围相交，请检查水面是否穿过地板或室内。');
    buildings.push({ objectId: object.id, walkableCells, entrances, floorGaps, wallGaps, roofGaps });
  }
  for (const window of objects.filter(o => o.kind === 'window')) {
    if (!window.members?.length) {
      let windowHint = null;
      const building = objects.find(o => o.kind === 'building' && (
        within([window.from[0], window.from[1], window.from[2]], o) || within([window.to[0], window.to[1], window.to[2]], o)));
      if (building) {
        for (let x = building.from[0]; x <= building.to[0] && !windowHint; x++) for (let y = building.from[1] + 1; y < building.to[1] && !windowHint; y++) for (let z = building.from[2]; z <= building.to[2]; z++) {
          const face = x === building.from[0] || x === building.to[0] || z === building.from[2] || z === building.to[2];
          if (face && cells.get(key([x, y, z])) === 'wood') windowHint = { from: [x, y, z], to: [x, y, z] };
        }
      }
      add(window, 'window-unverified', '没有精确玻璃归属；请把 glass 嵌入仍有木墙的外墙位置，不要选已经清空的门洞。',
        windowHint ? `建议在仍有木墙的位置 ${JSON.stringify(windowHint.from)} 用 replace 将 wood 换成 glass，并把 objectId 设为 ${window.id}。` : null,
        windowHint ? { type: 'window', object: { id: window.id, name: window.name, kind: window.kind, from: windowHint.from, to: windowHint.to }, from: windowHint.from, to: windowHint.to } : null);
      continue;
    }
    const embedded = window.members.every(p => cells.get(key(p)) === 'glass' && objects.some(o => {
      if (o.kind !== 'building' || !within(p, o) || p[1] <= o.from[1]) return false;
      const faceX = p[0] === o.from[0] || p[0] === o.to[0], faceZ = p[2] === o.from[2] || p[2] === o.to[2];
      if (!faceX && !faceZ) return false;
      const offsets = [[0, 1, 0], [0, -1, 0], ...(faceX ? [[0, 0, 1], [0, 0, -1]] : [[1, 0, 0], [-1, 0, 0]])];
      return offsets.some(d => { const q = p.map((v, i) => v + d[i]); return within(q, o) && solid(cells.get(key(q))) && cells.get(key(q)) !== 'glass'; });
    }));
    if (!embedded) add(window, 'window-detached', '玻璃与外墙位置或支撑不一致，请检查窗户是否悬空。');
  }
  return { scope: 'single-level-rectangular', buildings, issues };
}

// Safe, bounded repairs for the two diagnostics whose intent is unambiguous.
// The UI can offer these without asking the model to rediscover coordinates or
// object ownership. Other findings stay model-assisted until their edit is
// equally unambiguous.
export function buildVoxelRepairCommands(_world, issue) {
  const repair = issue?.repair;
  if (repair?.type === 'entrance') return [
    { op: 'fill', from: [...repair.door.from], to: [...repair.door.to], material: null, objectId: repair.objectId },
    { op: 'fill', from: [...repair.outside], to: [...repair.outside], material: 'grass' },
  ];
  if (repair?.type === 'window') return [
    { op: 'object', ...repair.object },
    { op: 'replace', from: [...repair.from], to: [...repair.to], match: 'wood', material: 'glass', objectId: repair.object.id },
  ];
  return null;
}
