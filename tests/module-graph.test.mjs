import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODULE_LAYERS, discoverSourceFiles, discoverModuleFiles, inspectModuleImports,
  resolveModuleImport, validateModuleGraph,
} from '../scripts/module-graph.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function repository(t, sources = {}, layers = MODULE_LAYERS) {
  const base = resolve(root, '.tmp/test');
  mkdirSync(base, { recursive: true });
  const folder = mkdtempSync(resolve(base, 'module-graph-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (const layer of Object.keys(layers)) mkdirSync(resolve(folder, layer), { recursive: true });
  for (const [name, source] of Object.entries(sources)) {
    const file = resolve(folder, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return folder;
}

test('source discovery recurses deterministically and excludes caches, vendors and symlinks', t => {
  const folder = repository(t, {
    'server.mjs': '', 'ui/app.js': '', 'creation/deep/nested/state.mjs': '',
    'scripts/nested/check.cjs': '', 'tests/nested/state.test.mjs': '',
    'tests/nested/observe-state.mjs': '', 'model/nested/observe-model.mjs': '',
    'ui/readme.txt': '', 'ui/.hidden.js': '', 'ui/.cache/ignored.js': '',
    '.tmp/ignored.mjs': '', '.git/ignored.js': '', '.data/ignored.js': '',
    'ui/node_modules/ignored.js': '', 'ui/vendor/ignored.js': '',
    'dist/ignored.js': '', 'build/ignored.js': '', 'coverage/ignored.js': '',
  });
  symlinkSync(resolve(folder, 'ui/app.js'), resolve(folder, 'linked.js'));
  symlinkSync(resolve(folder, 'creation'), resolve(folder, 'ui/linked-directory'));
  symlinkSync(folder, resolve(folder, 'ui/loop'));
  symlinkSync(resolve(folder, 'absent.js'), resolve(folder, 'dangling.js'));
  const files = discoverSourceFiles(folder).map(file => relative(folder, file));
  assert.deepEqual(files, [
    'creation/deep/nested/state.mjs', 'model/nested/observe-model.mjs',
    'scripts/nested/check.cjs', 'server.mjs', 'tests/nested/observe-state.mjs',
    'tests/nested/state.test.mjs', 'ui/app.js',
  ]);
  assert.deepEqual(discoverSourceFiles(resolve(folder, 'ui/linked-directory')), []);
  assert.deepEqual(discoverModuleFiles(folder).map(file => relative(folder, file)).sort(), [
    'creation/deep/nested/state.mjs', 'ui/app.js',
  ]);
});

test('unified verification checks nested syntax, discovers nested tests and runs observations in order', t => {
  // Run only an isolated tiny repository, never the real observation scripts.
  const record = name => `import { appendFileSync } from 'node:fs'; appendFileSync('ran.txt', '${name}\\n');`;
  const folder = repository(t, {
    'verify.mjs': readFileSync(resolve(root, 'verify.mjs'), 'utf8'),
    'scripts/module-graph.mjs': readFileSync(resolve(root, 'scripts/module-graph.mjs'), 'utf8'),
    'scripts/nested/syntax-only.mjs': "throw new Error('Syntax checks must not execute scripts');",
    'tests/nested/discovered.test.mjs': `import test from 'node:test'; import { appendFileSync } from 'node:fs'; test('nested', () => { appendFileSync('ran.txt', 'test\\n'); });`,
    'tests/nested/observe-test.mjs': record('test-observation'),
    'model/nested/observe-model.mjs': record('model-observation'),
  });
  const run = () => spawnSync(process.execPath, ['verify.mjs'], { cwd: folder, encoding: 'utf8', timeout: 10000 });
  const result = run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(resolve(folder, 'ran.txt'), 'utf8'), 'test\ntest-observation\nmodel-observation\n');
  mkdirSync(resolve(folder, 'creation/deep'), { recursive: true });
  writeFileSync(resolve(folder, 'creation/deep/broken.mjs'), 'export const broken = ;');
  const broken = run();
  assert.equal(broken.error, undefined);
  assert.notEqual(broken.status, 0);
  assert.match(broken.stderr, /creation\/deep\/broken\.mjs/);
  assert.match(broken.stderr, /SyntaxError/);
});

test('imports include multiline declarations, reexports, escapes and literal dynamic imports', () => {
  const source = [
    "import './side-effect.mjs';",
    'import defaultValue, {',
    '  source as renamed,',
    "} /* comment */ from './named.mjs';",
    "import defaultValue, * as namespace from './namespace.mjs';",
    "import * as other from './star.mjs';",
    "export { value as renamed } from './reexport.mjs';",
    "export * from './all.mjs';",
    "export * as namespace from './all-named.mjs';",
    "import { '}' as value } from './string-binding.mjs';",
    "export { value as '}' } from './string-export.mjs';",
    "await import(/* comment */ './dynamic.mjs');",
    "await import('./attributes.mjs', { with: { type: 'json' } });",
    'await import(`./literal-template.mjs`);',
    String.raw`await import('.\x2fescaped\u002emjs');`,
    String.raw`export { value } from '.\u{2f}unicode.mjs';`,
    "export { renamed };",
  ].join('\n');
  assert.deepEqual(inspectModuleImports(source), [
    './side-effect.mjs', './named.mjs', './namespace.mjs', './star.mjs',
    './reexport.mjs', './all.mjs', './all-named.mjs', './string-binding.mjs', './string-export.mjs', './dynamic.mjs',
    './attributes.mjs', './literal-template.mjs', './escaped.mjs', './unicode.mjs',
  ]);
});

test('comments, strings, regexes and property names do not invent dependencies', () => {
  const source = [
    '#!/usr/bin/env node',
    "// import './comment.mjs'; import(path);",
    "/* export * from './comment.mjs'; import(path); */",
    `const text = "import('./string.mjs')";`,
    "const template = `export * from './text.mjs'; ${ {text: 'import(path)'} }`;",
    String.raw`const pattern = /import\(['"]fake['"]\)/;`,
    String.raw`if (ready) /import\(path\)/.test(text);`,
    String.raw`function pattern() { return /import\(path\)/; }`,
    "const quotient = total / import('./division.mjs').then(value => value.size) / 2;",
    'loader.import(path); loader?.import(path);',
    'const { import: load } = loader;',
    'const meta = import.meta.url;',
    "export const from = './not-a-module.mjs';",
    'export { text };',
    "import './real.mjs';",
  ].join('\n');
  assert.deepEqual(inspectModuleImports(source), ['./division.mjs', './real.mjs']);
});

test('template expressions are inspected, including nested templates and blocks', () => {
  const source = [
    "const text = `ignored import(path) ${ { value: import('./inside.mjs') }.value }`;",
    "const nested = `outer ${ `inner ${import('./nested.mjs')}` }`;",
    "const block = `outer ${ (() => { return import('./block.mjs'); })() }`;",
  ].join('\n');
  assert.deepEqual(inspectModuleImports(source), ['./inside.mjs', './nested.mjs', './block.mjs']);
  assert.throws(() => inspectModuleImports('const text = `inner ${import(path)}`;', 'spatial/nested/rules.mjs'),
    /spatial\/nested\/rules\.mjs:1: Nonliteral dynamic import/);
});

test('nonliteral dynamic imports fail closed instead of disappearing from the graph', () => {
  for (const expression of [
    'path', "'./' + name", '`./${name}.mjs`', "('./literal.mjs')",
    "'./literal.mjs' + suffix", "String('./literal.mjs')", '...paths',
  ]) {
    assert.throws(() => inspectModuleImports(`\nawait import(${expression});`, 'creation/nested/load.mjs'),
      /creation\/nested\/load\.mjs:2: Nonliteral dynamic import/, expression);
  }
  // Keyword-shaped properties and escaped identifiers are expression values,
  // so a following slash is division and cannot conceal an import() call.
  for (const prefix of ['object.return', 'object?.await', 'object.if()', 'object?.while()', "'if'()", String.raw`\u{61}return`]) {
    assert.throws(() => inspectModuleImports(`${prefix} / import(path) / 2;`), /Nonliteral dynamic import/, prefix);
  }
  for (const value of ['.', '?.']) {
    assert.throws(() => inspectModuleImports(`const text = '${value}'\nimport(path);`), /Nonliteral dynamic import/, value);
  }
});

test('the production policy retains ten layers and accepts nested allowed dependencies', t => {
  assert.equal(Object.keys(MODULE_LAYERS).length, 10);
  const folder = repository(t, {
    'ui/nested/app.js': "import '../../rendering/nested/scene.mjs'; import '../../residents/actor.mjs';",
    'rendering/nested/scene.mjs': "export * from '../../spatial/nested/rules.mjs';",
    'spatial/nested/rules.mjs': 'export const value = 1;',
    'residents/actor.mjs': 'export const value = 1;',
    'creation/nested/load.mjs': "import '../shared.mjs';",
    'creation/shared.mjs': 'export const value = 1;',
  });
  const graph = validateModuleGraph(folder);
  assert.equal(graph.files.length, 6);
  assert.deepEqual([...graph.edges.get('ui')], ['rendering', 'residents']);
});

test('nested forbidden imports are rejected through every supported module form', t => {
  for (const statement of [
    "import '../../creation/deep/state.mjs';",
    "export { value } from '../../creation/deep/state.mjs';",
    "export * from '../../creation/deep/state.mjs';",
    "await import('../../creation/deep/state.mjs');",
    "await import('/vendor/../creation/deep/state.mjs');",
    "await import('/vendor/%2e%2e/creation/deep/state.mjs');",
    String.raw`await import('..\x2f..\x2fcreation/deep/state.mjs');`,
    "const text = `result ${import('../../creation/deep/state.mjs')}`;",
  ]) {
    const folder = repository(t, {
      'transport/nested/route.mjs': statement,
      'creation/deep/state.mjs': 'export const value = 1;',
    });
    assert.throws(() => validateModuleGraph(folder), /transport must not depend on creation: transport\/nested\/route\.mjs/, statement);
  }
});

test('nested computed imports fail during production graph validation', t => {
  const folder = repository(t, { 'creation/deep/load.mjs': 'export const load = path => import(path);' });
  assert.throws(() => validateModuleGraph(folder), /creation\/deep\/load\.mjs:1: Nonliteral dynamic import/);
});

test('nested missing imports fail even when they are reexports or dynamic imports', t => {
  for (const statement of [
    "import './absent.mjs';", "export * from './absent.mjs';", "await import('./absent.mjs');",
  ]) {
    const folder = repository(t, { 'creation/deep/load.mjs': statement });
    assert.throws(() => validateModuleGraph(folder), /creation\/deep\/load\.mjs has missing import \.\/absent\.mjs/, statement);
  }
});

test('nested cross-layer cycles are rejected even when each individual edge is allowed', t => {
  const layers = { ui: ['rendering'], rendering: ['ui'] };
  const folder = repository(t, {
    'ui/nested/view.mjs': "export * from '../../rendering/nested/scene.mjs';",
    'rendering/nested/scene.mjs': "await import('../../ui/nested/view.mjs');",
  }, layers);
  assert.throws(() => validateModuleGraph(folder, layers), /Module dependency cycle: ui → rendering → ui/);
});

test('imports cannot bypass the graph through ignored files, directories or symlinks', t => {
  const folder = repository(t, {
    'creation/nested/load.mjs': '',
    'creation/.cache/private.mjs': '',
    'creation/observe-private.mjs': '',
    'creation/shared.mjs': '',
  });
  const file = resolve(folder, 'creation/nested/load.mjs');
  for (const specifier of ['../.cache/private.mjs', '../observe-private.mjs']) {
    writeFileSync(file, `import '${specifier}';`);
    assert.throws(() => validateModuleGraph(folder), /outside checked sources/, specifier);
  }
  symlinkSync(resolve(folder, 'creation/shared.mjs'), resolve(folder, 'creation/linked.mjs'));
  symlinkSync(resolve(folder, 'creation'), resolve(folder, 'creation/linked-directory'));
  for (const specifier of ['../linked.mjs', '../linked-directory/shared.mjs']) {
    writeFileSync(file, `import '${specifier}';`);
    assert.throws(() => validateModuleGraph(folder), /missing import|through a symlink/, specifier);
  }
  assert.throws(() => resolveModuleImport(folder, file, '../../../outside.mjs'), /outside repository/);
  assert.throws(() => resolveModuleImport(folder, file, '..'), /missing import/);
  assert.throws(() => resolveModuleImport(folder, file, 'file:///private.mjs'), /Unsupported module URL/);
  assert.throws(() => resolveModuleImport(folder, file, '//example.com/module.mjs'), /Unsupported module URL/);
});

test('browser-style root imports and URL suffixes resolve to checked source files', t => {
  const folder = repository(t, {
    'ui/nested/app.js': "await import('/rendering/scene.mjs?version=2#module');",
    'rendering/scene.mjs': "import '../spatial/rules%20and%20maps.mjs'; import '/vendor/three.module.js';",
    'spatial/rules and maps.mjs': '',
  });
  assert.equal(validateModuleGraph(folder).files.length, 3);
});
