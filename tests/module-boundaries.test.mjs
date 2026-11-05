import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverModuleFiles, inspectModuleImports, resolveModuleImport, validateModuleGraph } from '../scripts/module-graph.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleFiles = discoverModuleFiles(root);
const imports = file => inspectModuleImports(readFileSync(file, 'utf8'), relative(root, file));
const layerOf = file => relative(root, file).split(sep)[0];

test('ten module boundaries resolve their imports and have no dependency cycles', () => {
  validateModuleGraph(root);
});

test('creation flows receive request, persistence and runtime capabilities instead of constructing them', () => {
  const forbidden = new Set([
    'creation/world-creation.mjs', 'creation/workspace.mjs', 'creation/request-session.mjs',
    'creation/world-lifecycle.mjs', 'creation/controls.mjs', 'creation/model-gateway.mjs',
    'model/config.mjs', 'model/model-client.mjs',
  ]);
  for (const file of moduleFiles.filter(file => relative(root, file).startsWith(`creation${sep}flows${sep}`))) {
    for (const specifier of imports(file)) {
      const target = resolveModuleImport(root, file, specifier);
      if (!target) continue;
      const local = relative(root, target).split(sep).join('/');
      assert(!forbidden.has(local) && !['storage', 'transport', 'ui', 'simulation'].includes(layerOf(target)),
        `${relative(root, file)} must use injected capabilities instead of ${local}`);
    }
  }
});

test('domain modules delegate file access and spatial rules do not load a rendering engine', () => {
  for (const file of moduleFiles) {
    const owner = layerOf(file);
    const dependencies = imports(file);
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
    for (const specifier of imports(file)) {
      assert(!specifier.startsWith('node:'), `Browser dependency ${relative(root, file)} loads ${specifier}`);
      if (specifier === 'three' || specifier.startsWith('three/')) continue;
      assert(specifier.startsWith('.') || specifier.startsWith('/'), `Unknown browser import ${specifier}`);
      const target = resolveModuleImport(root, file, specifier);
      if (target) visit(target);
    }
  };
  visit(resolve(root, 'ui/app.js'));
});
