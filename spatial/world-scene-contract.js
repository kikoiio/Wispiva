// Generated worlds use the SceneDocument shape, with a closed field set so
// document data cannot add executable or unsupported behavior.
export function validateWorldSceneFields(scene) {
  const errors = [];
  const add = (path, code, message) => errors.push({ path, code, message, nodeId: path, operationId: 'validate-world', requirementId: code });
  const list = (value, min, max, path) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) {
      add(path, 'collection-size', `Expected ${min}..${max} entries.`);
      return [];
    }
    return value;
  };
  const optionalShape = (value, required, optional, path) => {
    if (!record(value)) { add(path, 'object', 'Expected an object.'); return; }
    for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) add(`${path}.${key}`, 'unknown-field', 'Unsupported scene field.');
    for (const key of required) if (!Object.hasOwn(value, key)) add(`${path}.${key}`, 'required', 'Required scene field.');
  };
  optionalShape(scene, ['schemaVersion', 'profile', 'id', 'title', 'style', 'regions', 'objects'], [], 'scene');
  if (!record(scene)) return errors;
  optionalShape(scene.style, ['palette', 'voxelUnit', 'seed'], [], 'scene.style');
  const regions = list(scene.regions, 1, 12, 'scene.regions');
  regions.forEach((region, i) => optionalShape(region, ['id', 'kind', 'center', 'elevation', ...(region?.kind === 'water' ? ['size'] : ['radius', 'irregularity'])], [], `scene.regions[${i}]`));
  const fields = {
    library: ['transform', 'bounds', 'roof', 'entrance', 'windows', 'parts', 'attachments'],
    house: ['transform', 'bounds', 'roof', 'entrance', 'windows', 'parts', 'attachments'],
    porch: ['transform', 'bounds', 'attachments'], bridge: ['from', 'to', 'width', 'arch', 'segments', 'attachments'],
    room: ['transform', 'bounds'],
    tree: ['position', 'scale', 'seed'], path: ['points', 'width'], character: ['position', 'route', 'speed'],
  };
  const objects = list(scene.objects, 1, 80, 'scene.objects');
  objects.forEach((node, i) => {
    const p = `scene.objects[${i}]`;
    optionalShape(node, ['id', 'kind'], ['name', ...(fields[node?.kind] ?? [])], p);
    if (!record(node)) return;
    for (const [key, keys] of Object.entries({ transform: ['position', 'rotation'], bounds: ['width', 'depth', 'wallHeight', 'floor'], roof: ['kind', 'rise', 'overhang'], entrance: ['wall', 'width', 'height'], from: ['region', 'point'], to: ['region', 'point'] })) {
      if (Object.hasOwn(node, key)) optionalShape(node[key], [], keys, `${p}.${key}`);
    }
    for (const [key, keys] of [['windows', ['wall', 'offset']], ['attachments', ['target', 'relation']]]) {
      if (Array.isArray(node[key])) node[key].forEach((entry, j) => optionalShape(entry, keys, [], `${p}.${key}[${j}]`));
    }
    if (node.parts !== undefined && (!Array.isArray(node.parts) || !node.parts.every((v) => typeof v === 'string' && ['walls', 'roof', 'bookshelves', 'reading-table', 'lamp'].includes(v)))) add(`${p}.parts`, 'parts', 'Unsupported building parts.');
  });
  return errors;
}

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
