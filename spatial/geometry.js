export const diagnostic = (nodeId, operationId, requirementId, message) => ({ nodeId, operationId, requirementId, message });
export const formatDiagnostic = e => `${e.message} (nodeId=${e.nodeId}, operationId=${e.operationId}, requirementId=${e.requirementId})`;

export function islandRadius(region, angle) {
  return region.radius * (1 + region.irregularity * (Math.sin(angle * 3) + Math.cos(angle * 5) * 0.45));
}
export function islandContains(region, x, z, margin = 0) {
  const dx = x - region.center[0], dz = z - region.center[1];
  return Math.hypot(dx, dz) + margin <= islandRadius(region, Math.atan2(dz, dx));
}
export function bridgePoint(bridge, t) {
  return bridge.from.point.map((v, i) => v + (bridge.to.point[i] - v) * t + (i === 1 ? Math.sin(Math.PI * t) * bridge.arch : 0));
}
export function localToWorld(object, x, z) {
  const [px, , pz] = object.transform.position, a = object.transform.rotation;
  return [px + x * Math.cos(a) + z * Math.sin(a), pz - x * Math.sin(a) + z * Math.cos(a)];
}
export function rectAxes(object) {
  const a = object.transform?.rotation ?? 0;
  return [[Math.cos(a), -Math.sin(a)], [Math.sin(a), Math.cos(a)]];
}
export function rectCorners(object, extra = 0) {
  return [-1, 1].flatMap(x => [-1, 1].map(z =>
    localToWorld(object, x * (object.bounds.width / 2 + extra), z * (object.bounds.depth / 2 + extra))));
}
export function pointSegmentDistance(px, pz, a, b) {
  const vx = b[0] - a[0], vz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[2]) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (a[0] + vx * t), pz - (a[2] + vz * t));
}
export function pointInRect(object, px, pz, margin = 0) {
  const dx = px - object.transform.position[0], dz = pz - object.transform.position[2];
  const a = object.transform?.rotation ?? 0;
  return Math.abs(dx * Math.cos(a) - dz * Math.sin(a)) <= object.bounds.width / 2 + margin &&
    Math.abs(dx * Math.sin(a) + dz * Math.cos(a)) <= object.bounds.depth / 2 + margin;
}
export function rectsSeparated(a, b, gap) {
  const dx = b.transform.position[0] - a.transform.position[0], dz = b.transform.position[2] - a.transform.position[2];
  for (const rect of [a, b]) for (const [ux, uz] of rectAxes(rect)) {
    const extent = r => {
      const [ax, az] = rectAxes(r);
      return (r.bounds.width / 2 + gap / 2) * Math.abs(ux * ax[0] + uz * ax[1]) +
        (r.bounds.depth / 2 + gap / 2) * Math.abs(ux * az[0] + uz * az[1]);
    };
    if (Math.abs(dx * ux + dz * uz) > extent(a) + extent(b)) return true;
  }
  return false;
}
