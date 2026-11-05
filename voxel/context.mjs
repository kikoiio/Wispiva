import { inspectVoxelSpaces } from '../spatial/voxel-inspection.js';

export function voxelContext(voxel) {
  const cells = voxel.cells.slice(0, 5000);
  const objects = voxel.objects.map(o => o.members?.length > 64 ? { ...o, members: undefined,
    memberRegions: compactRegions(o.members.map(position => ({ position }))) } : o);
  const base = { revision: voxel.revision, cellCount: voxel.cells.length, truncated: voxel.cells.length > 5000, objects,
    inspection: inspectVoxelSpaces(voxel) };
  if (cells.length <= 64) return { ...base, cells };
  return { ...base, regions: compactRegions(cells) };
}

function compactRegions(cells) {
  const sorted = [...cells].sort((a,b) => a.position[1]-b.position[1] || a.position[2]-b.position[2] || a.position[0]-b.position[0]);
  const regions = [];
  for (const {position,material} of sorted) {
    const previous = regions.at(-1);
    if (previous && previous.material === material && previous.to[1] === position[1] && previous.to[2] === position[2] && previous.to[0]+1 === position[0]) previous.to[0] = position[0];
    else regions.push({ from:[...position], to:[...position], ...(material === undefined ? {} : { material }) });
  }
  return regions;
}
