import { expandVoxelTools } from './voxel-tools.mjs';
import { VOXEL_MATERIALS } from './voxel-world.mjs';
import { MAX_BUILD_COMMANDS } from './creation-limits.mjs';

class BuildingError extends Error {
  constructor(message, path, detail) {
    super(message);
    this.diagnostics = [{ path, message: detail || message }];
  }
}

// A box's two corners are interchangeable. A roof's eave and height cap are not.
export function normalizeBuildingCommands(commands) {
  if (!Array.isArray(commands) || !commands.length || commands.length > MAX_BUILD_COMMANDS) throw new BuildingError(`这次建造步骤超过 ${MAX_BUILD_COMMANDS} 条命令，请缩小到一个部件。`, 'commands');
  const adjustments = [];
  const normalized = commands.map((raw, index) => {
    const path = `commands[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BuildingError('建造步骤格式不完整，可按原意图重试。', path);
    const command = structuredClone(raw);
    if (command.op === 'building' && Array.isArray(command.from) && Array.isArray(command.to)
        && command.from.length === 3 && command.to.length === 3 && command.from[1] !== command.to[1]) {
      throw new BuildingError('建筑占地需要位于同一层。', `${path}.from[1]`);
    }
    const materialFields = ['object', 'remove-object'].includes(command.op) ? [] : command.op === 'building'
      ? ['floorMaterial', 'wallMaterial', 'roofMaterial'].filter(field => Object.hasOwn(command, field))
      : ['material', ...(command.op === 'replace' ? ['match'] : [])];
    for (const field of materialFields) {
      const value = command[field];
      if (command.op === 'building' && (value === null || value === 'air' || value === 'null')) {
        throw new BuildingError('完整建筑的地板、墙和屋顶需要实心材料。', `${path}.${field}`);
      }
      if (value === null) continue;
      const material = typeof value === 'string' ? value.trim().toLowerCase() : value;
      if (material === 'air' || material === 'null') {
        command[field] = null;
        adjustments.push({ path: `${path}.${field}`, message: `已将 ${material} 明确转换为空格 null。` });
        continue;
      }
      if (!VOXEL_MATERIALS.includes(material)) throw new BuildingError('模型选用了当前不支持的材料。可以按原意图重试，让它使用现有材料；也可以说明替代材料。', `${path}.${field}`,
        `未知材料 ${String(value).slice(0, 80)}；可用材料：${VOXEL_MATERIALS.join('、')}，清空使用 null。不要猜测替代材料。`);
      if (material !== value) adjustments.push({ path: `${path}.${field}`, message: '已统一材料名的大小写和首尾空格。' });
      command[field] = material;
    }
    const points = [command.from, command.to];
    if (points.every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isSafeInteger))) {
      if (command.op === 'roof' && command.from[1] > command.to[1]) throw new BuildingError('屋顶的檐口和最高处不明确，这次没有修改。可重试或说明屋顶高度。', `${path}.from[1]`, 'roof.from.y 是檐口高度，roof.to.y 是高度上限，不能交换猜测。');
      const from = points[0].map((v, i) => Math.min(v, points[1][i]));
      const to = points[0].map((v, i) => Math.max(v, points[1][i]));
      if (from.some((v, i) => v !== command.from[i])) adjustments.push({ path, message: '已将同一区域的两个角点按各轴排序，区域范围不变。' });
      command.from = from; command.to = to;
    }
    try { expandVoxelTools([command]); }
    catch (error) { throw new BuildingError('建造步骤未通过检查，这次没有修改。可以按原意图重试或缩小范围。', path, error.message); }
    return command;
  });
  return { commands: normalized, adjustments };
}

export function describeChanges(changes) {
  return { cells: changes.cells.length, objects: changes.objects.length,
    added: changes.cells.filter(c => c.before === null).length,
    removed: changes.cells.filter(c => c.after === null).length,
    replaced: changes.cells.filter(c => c.before !== null && c.after !== null).length };
}

export const recoverableAttempt = attempt => attempt && ['failed', 'cancelled', 'not-built', 'partial'].includes(attempt.outcome);
