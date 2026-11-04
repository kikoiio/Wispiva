// The output fits the existing voxel edit budget without needing world state.
const MAX_COMMANDS = 128;
const MAX_SCAN = 32768;
const materialPattern = /^[a-z][a-z0-9_.:-]{0,63}$/;
const validString = value => typeof value === 'string' && value.length <= 256 && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);

function bounds(command) {
  for (const point of [command.from, command.to]) {
    if (!Array.isArray(point) || point.length !== 3 || !point.every(n => Number.isSafeInteger(n) && Math.abs(n) <= 1024)) {
      throw new Error('坐标必须是范围内的三个整数');
    }
  }
  if (command.from.some((n, i) => n > command.to[i])) throw new Error('区域起点必须小于或等于终点');
}

function checkMaterial(value) {
  if (value !== null && (typeof value !== 'string' || !materialPattern.test(value))) throw new Error('方块类型无效');
}

function buildingPlanCommands(command) {
  bounds(command);
  if (!validString(command.id) || !validString(command.name)) throw new Error('建筑方案需要有效的对象 ID 和名称');
  const [x0, floor, z0] = command.from, [x1, toY, z1] = command.to;
  if (toY !== floor) throw new Error('建筑方案的 from.y 和 to.y 必须相同，表示同一层地面');
  const width = x1 - x0 + 1, depth = z1 - z0 + 1;
  if (width < 3 || depth < 3 || width > 32 || depth > 32) throw new Error('建筑占地需为 3×3 至 32×32 格');
  const wallHeight = command.wallHeight ?? 3, roofRise = command.roofRise ?? 2;
  if (!Number.isSafeInteger(wallHeight) || wallHeight < 3 || wallHeight > 8) throw new Error('建筑墙高需为 3 至 8 格');
  const maximumRise = Math.floor((width + 1) / 2);
  if (!Number.isSafeInteger(roofRise) || roofRise < 1 || roofRise > maximumRise) throw new Error(`屋顶高度需为 1 至 ${maximumRise} 格`);
  const floorMaterial = command.floorMaterial === undefined ? 'wood' : command.floorMaterial;
  const wallMaterial = command.wallMaterial === undefined ? 'wood' : command.wallMaterial;
  const roofMaterial = command.roofMaterial === undefined ? 'roof' : command.roofMaterial;
  for (const material of [floorMaterial, wallMaterial, roofMaterial]) {
    checkMaterial(material);
    if (material === null || material === 'water') throw new Error('建筑结构材料不能是空格或 water');
  }
  const entrance = command.entrance ?? { wall: 'south' };
  if (!entrance || !['north', 'south', 'east', 'west'].includes(entrance.wall)) throw new Error('门洞必须指定 north、south、east 或 west 墙面');
  const along = entrance.wall === 'north' || entrance.wall === 'south' ? width : depth;
  const offset = entrance.offset === undefined ? Math.floor(along / 2) : entrance.offset;
  if (!Number.isSafeInteger(offset) || offset < 1 || offset > along - 2) throw new Error('门洞偏移必须位于外墙的非角落位置');
  const roofId = `${command.id}-roof`;
  if (!validString(roofId)) throw new Error('建筑 ID 太长，无法生成屋顶对象 ID');
  const eave = floor + wallHeight;
  const ridge = eave + roofRise;
  const roofFrom = [x0 - 1, eave, z0 - 1], roofTo = [x1 + 1, ridge, z1 + 1];
  const door = entrance.wall === 'north' ? [x0 + offset, floor + 1, z0]
    : entrance.wall === 'south' ? [x0 + offset, floor + 1, z1]
    : entrance.wall === 'west' ? [x0, floor + 1, z0 + offset]
    : [x1, floor + 1, z0 + offset];
  const outside = entrance.wall === 'north' ? [door[0], floor, z0 - 1]
    : entrance.wall === 'south' ? [door[0], floor, z1 + 1]
    : entrance.wall === 'west' ? [x0 - 1, floor, door[2]]
    : [x1 + 1, floor, door[2]];
  const commands = [
    { op: 'object', id: command.id, name: command.name, kind: 'building', from: [x0, floor, z0], to: [x1, ridge, z1] },
    { op: 'object', id: roofId, name: `${command.name}屋顶`, kind: 'roof', from: roofFrom, to: roofTo },
    { op: 'fill', from: [x0, floor, z0], to: [x1, floor, z1], material: floorMaterial, objectId: command.id },
    { op: 'walls', from: [x0, floor + 1, z0], to: [x1, eave, z1], material: wallMaterial, objectId: command.id },
    { op: 'fill', from: door, to: [door[0], floor + 2, door[2]], material: null, objectId: command.id },
    { op: 'fill', from: outside, to: outside, material: 'grass' },
    { op: 'roof', from: roofFrom, to: roofTo, material: roofMaterial, objectId: roofId },
  ];
  // Validate computed overhangs and any support cell before applying them.
  for (const generated of commands) if (generated.from && generated.to) bounds(generated);
  return commands;
}

/**
 * Expand high-level commands into bounded, non-overlapping fill boxes.
 * Roof: at each x the surface is one voxel thick, at y = from.y +
 * min(x - from.x, to.x - x, to.y - from.y), extending along z.
 * Thus to.y is an inclusive height cap, and a low cap creates a flat ridge.
 * Base commands are retained unchanged; material registration is engine-specific.
 */
export function expandVoxelTools(commands) {
  if (!Array.isArray(commands) || commands.length === 0 || commands.length > MAX_COMMANDS) throw new Error('建造操作无效');
  const result = [];
  let scan = 0;
  function append(command, countCells = false) {
    if (result.length >= MAX_COMMANDS) throw new Error('展开指令数量超限');
    if (countCells) {
      const volume = command.from.reduce((n, v, i) => n * (command.to[i] - v + 1), 1);
      if (volume > MAX_SCAN - scan) throw new Error('操作扫描范围过大');
      scan += volume;
    }
    result.push(command);
  }
  for (const command of commands) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('不支持的建造操作');
    const { op } = command;
    if (command.objectId !== undefined && !validString(command.objectId)) throw new Error('对象 ID 无效');
    if (op === 'building') {
      const expanded = expandVoxelTools(buildingPlanCommands(command));
      for (const part of expanded) append(part, part.op === 'fill');
      continue;
    }
    if (op === 'copy') throw new Error('copy 需要当前世界，无法展开');
    if (op === 'remove-object' || op === 'paint-object') {
      if (!validString(command.id)) throw new Error('对象 ID 无效');
      if (op === 'paint-object') checkMaterial(command.material);
      append(command);
      continue;
    }
    if (!['fill', 'replace', 'object', 'walls', 'roof', 'hollow'].includes(op)) throw new Error('不支持的建造操作');
    bounds(command);
    if (op === 'object') {
      if (![command.id, command.name, command.kind].every(validString)) throw new Error('对象定义无效');
      append(command);
      continue;
    }
    checkMaterial(command.material);
    if (op === 'replace') checkMaterial(command.match);
    if (op === 'fill' || op === 'replace') {
      append(command, true);
      continue;
    }
    const [x0, y0, z0] = command.from, [x1, y1, z1] = command.to;
    const fill = (xa, ya, za, xb, yb, zb) => {
      if (xa > xb || ya > yb || za > zb) return;
      append({ op: 'fill', from: [xa, ya, za], to: [xb, yb, zb], material: command.material,
        ...(command.objectId === undefined ? {} : { objectId: command.objectId }) }, true);
    };
    if (op === 'roof') {
      for (let x = x0; x <= x1; x++) {
        const y = y0 + Math.min(x - x0, x1 - x, y1 - y0);
        fill(x, y, z0, x, y, z1);
      }
      continue;
    }
    // X faces include corners; Z faces cover only the remaining interior X.
    fill(x0, y0, z0, x0, y1, z1);
    if (x1 > x0) fill(x1, y0, z0, x1, y1, z1);
    fill(x0 + 1, y0, z0, x1 - 1, y1, z0);
    if (z1 > z0) fill(x0 + 1, y0, z1, x1 - 1, y1, z1);
    if (op === 'hollow') {
      // Add the floor and ceiling only where the walls have not already filled.
      fill(x0 + 1, y0, z0 + 1, x1 - 1, y0, z1 - 1);
      if (y1 > y0) fill(x0 + 1, y1, z0 + 1, x1 - 1, y1, z1 - 1);
    }
  }
  return result;
}
