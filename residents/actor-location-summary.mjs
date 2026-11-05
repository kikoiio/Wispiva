export function actorLocationSummary(world) {
  const actors = Array.isArray(world?.actors) ? world.actors : [];
  if (!actors.length) return '人物地点（地点级）：暂无人物。';
  const places = Array.isArray(world?.places) ? world.places : [];
  const entries = actors.map(actor => {
    const matches = places.filter(place => place?.id === actor?.location);
    const location = matches.length === 1 ? matches[0].name || '未命名地点' : '地点未匹配';
    return `${actor?.name || '人物'}：${location}`;
  });
  return `人物地点（地点级）：${entries.join('；')}`;
}
