import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const layers = {
  ui: ['rendering', 'spatial', 'residents'],
  rendering: ['spatial'],
  transport: [],
  creation: ['simulation', 'residents', 'model', 'voxel', 'spatial', 'rendering', 'storage'],
  voxel: ['spatial', 'storage'],
  spatial: [],
  simulation: ['spatial', 'storage'],
  residents: ['simulation'],
  model: [],
  storage: [],
};
const moduleFiles = Object.keys(layers).flatMap(layer => readdirSync(resolve(root, layer))
  .filter(name => /\.(?:mjs|js)$/.test(name) && !name.startsWith('observe-'))
  .map(name => resolve(root, layer, name)));
const imports = source => [...source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
  .map(match => match[1] ?? match[2]);
const layerOf = file => relative(root, file).split(sep)[0];

test('ten module boundaries resolve their imports and have no dependency cycles', () => {
  const edges = new Map(Object.keys(layers).map(layer => [layer, new Set()]));
  for (const file of moduleFiles) {
    const owner = layerOf(file);
    for (const specifier of imports(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
      if (specifier.startsWith('/vendor/')) continue;
      const target = specifier.startsWith('/') ? resolve(root, `.${specifier}`) : resolve(dirname(file), specifier);
      assert(existsSync(target), `${relative(root, file)} has missing import ${specifier}`);
      const dependency = layerOf(target);
      if (dependency === owner) continue;
      assert(layers[owner].includes(dependency), `${owner} must not depend on ${dependency}: ${relative(root, file)}`);
      edges.get(owner).add(dependency);
    }
  }
  const visit = (layer, path) => {
    assert(!path.includes(layer), `Module dependency cycle: ${[...path, layer].join(' → ')}`);
    for (const dependency of edges.get(layer)) visit(dependency, [...path, layer]);
  };
  for (const layer of Object.keys(layers)) visit(layer, []);
});

test('domain modules delegate file access and spatial rules do not load a rendering engine', () => {
  for (const file of moduleFiles) {
    const owner = layerOf(file);
    const dependencies = imports(readFileSync(file, 'utf8'));
    if (['creation', 'simulation', 'residents', 'voxel', 'spatial'].includes(owner)) {
      assert(!dependencies.some(specifier => /^(?:node:)?fs(?:\/|$)/.test(specifier)), `${relative(root, file)} bypasses storage`);
    }
    if (['spatial', 'simulation', 'residents', 'voxel'].includes(owner)) {
      assert(!dependencies.some(specifier => /^three(?:\/|$)/.test(specifier)), `${relative(root, file)} loads Three.js`);
    }
  }
});

test('browser entry imports stay browser compatible through their full dependency graph', () => {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of imports(readFileSync(file, 'utf8'))) {
      assert(!specifier.startsWith('node:'), `Browser dependency ${relative(root, file)} loads ${specifier}`);
      if (specifier === 'three' || specifier.startsWith('three/') || specifier.startsWith('/vendor/')) continue;
      assert(specifier.startsWith('.') || specifier.startsWith('/'), `Unknown browser import ${specifier}`);
      const target = specifier.startsWith('/') ? resolve(root, `.${specifier}`) : resolve(dirname(file), specifier);
      assert(existsSync(target), `Missing browser module ${specifier} from ${relative(root, file)}`);
      visit(target);
    }
  };
  visit(resolve(root, 'ui/app.js'));
});
