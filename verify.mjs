import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const files = (directory, pattern) => readdirSync(resolve(repoRoot, directory))
  .filter(name => pattern.test(name)).sort().map(name => resolve(repoRoot, directory, name));
const testFiles = files('tests', /\.test\.mjs$/);
const observationFiles = ['tests', 'model'].flatMap(directory => files(directory, /^observe-.*\.mjs$/));
const modules = ['ui', 'rendering', 'transport', 'creation', 'voxel', 'spatial', 'simulation', 'residents', 'model', 'storage'];

const jobs = [
  ...['server.mjs', ...modules.flatMap(directory => files(directory, /\.(?:js|mjs)$/))].map(file => ['--check', file]),
  [
    '--test',
    '--test-isolation=none',
    '--test-concurrency=1',
    ...testFiles,
  ],
  ...observationFiles.map(file => [file]),
];

for (const args of jobs) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('Unified prototype checks passed. No model requests or browser sessions.');
