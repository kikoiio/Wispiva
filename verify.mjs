import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename, dirname, relative, sep } from 'node:path';
import { discoverSourceFiles } from './scripts/module-graph.mjs';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const sourceFiles = discoverSourceFiles(repoRoot);
const topDirectory = file => relative(repoRoot, file).split(sep)[0];
const testFiles = sourceFiles.filter(file => topDirectory(file) === 'tests' && /\.test\.mjs$/.test(basename(file)));
const observationFiles = ['tests', 'model'].flatMap(directory => sourceFiles
  .filter(file => topDirectory(file) === directory && /^observe-.*\.mjs$/.test(basename(file))));

const jobs = [
  ...sourceFiles.map(file => ['--check', file]),
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
