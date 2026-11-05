import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { availableParallelism, freemem, release, totalmem, platform, arch } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CampSimulation } from '../simulation/core.mjs';
import { createGeneratedFixture } from '../simulation/world-definition.mjs';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const outputRoot = resolve(root, '.tmp/prototype/soak');
const tempDir = resolve(process.env.TMPDIR || join(root, '.tmp/soak-tmp'));
mkdirSync(tempDir, { recursive: true });

function availableBytes(path) {
  try {
    const stats = statfsSync(path);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function cgroupMemoryLimitBytes() {
  try {
    const value = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    return value === 'max' ? null : Number(value);
  } catch {
    return null;
  }
}

function inspectState(path, day, elapsedMs = 0) {
  const simulation = CampSimulation.load(path);
  const state = simulation.snapshot();
  const head = state.history.at(-1);
  if (state.history.length !== state.revision + 1 || head?.worldMinute !== state.worldMinute
    || !isDeepStrictEqual(head?.world, state.world)) throw new Error('save-head-mismatch');
  return {
    day,
    worldMinute: state.worldMinute,
    revision: state.revision,
    historyEntries: state.history.length,
    processCount: state.world.processes.length,
    archiveBytes: statSync(path).size,
    elapsedMs: Math.round(elapsedMs * 10) / 10,
    rssBytes: process.memoryUsage().rss,
    heapUsedBytes: process.memoryUsage().heapUsed,
    maxRssKiB: process.resourceUsage().maxRSS,
    tmpDir: tempDir,
    tmpDirAvailableBytes: availableBytes(tempDir),
    systemTmpAvailableBytes: availableBytes('/tmp'),
    cgroupMemoryLimitBytes: cgroupMemoryLimitBytes(),
    runner: { platform: platform(), release: release(), arch: arch(), totalMemoryBytes: totalmem(), freeMemoryBytes: freemem(), cpuCount: availableParallelism() },
  };
}

function child(args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 180000,
    env: { PATH: process.env.PATH || '', TMPDIR: tempDir },
  });
  if (result.error || result.status !== 0) throw new Error(`soak-child-failed:${result.status ?? 'no-status'}`);
  return JSON.parse(result.stdout.trim());
}

const [mode, statePath, dayArg] = process.argv.slice(2);
if (mode === '--advance-day') {
  const day = Number(dayArg);
  if (!Number.isSafeInteger(day) || day < 1) throw new Error('invalid-day');
  const started = performance.now();
  const simulation = CampSimulation.load(statePath);
  const result = simulation.advanceWorld(1440);
  if (!result.ok || result.advancedMinutes !== 1440) throw new Error(`advance-failed:${result.reason}`);
  simulation.save(statePath);
  const sample = inspectState(statePath, day, performance.now() - started);
  if (sample.worldMinute !== day * 1440 || sample.revision !== day * 1440) throw new Error('unexpected-soak-progress');
  process.stdout.write(`${JSON.stringify(sample)}\n`);
} else if (mode === '--inspect') {
  process.stdout.write(`${JSON.stringify(inspectState(statePath, Number(dayArg) || 0))}\n`);
} else {
  const days = Number(process.env.WISPIVA_SOAK_DAYS || 7);
  if (!Number.isSafeInteger(days) || days < 1 || days > 14) throw new Error('WISPIVA_SOAK_DAYS must be an integer from 1 to 14');
  mkdirSync(outputRoot, { recursive: true });
  const runDir = mkdtempSync(join(outputRoot, 'run-'));
  const stateFile = join(runDir, 'simulation.json');
  const metricsFile = join(runDir, 'metrics.json');
  const simulation = new CampSimulation({ world: createGeneratedFixture().world });
  simulation.save(stateFile);
  const report = {
    scenario: 'synthetic-generated-world',
    simulatedDays: days,
    startedAt: new Date().toISOString(),
    sampleSource: 'one fresh Node process per simulated day; each process loads, advances, saves, and exits',
    samples: [],
  };
  const persist = () => writeFileSync(metricsFile, `${JSON.stringify(report, null, 2)}\n`);
  report.samples.push(child(['--inspect', stateFile, '0']));
  persist();
  for (let day = 1; day <= days; day += 1) {
    const sample = child(['--advance-day', stateFile, String(day)]);
    report.samples.push(sample);
    persist();
    process.stdout.write(`${JSON.stringify(sample)}\n`);
  }
  const final = child(['--inspect', stateFile, String(days)]);
  if (final.worldMinute !== days * 1440 || final.historyEntries !== final.revision + 1) throw new Error('final-reload-mismatch');
  report.finalReload = final;
  report.finishedAt = new Date().toISOString();
  persist();
  process.stdout.write(`${JSON.stringify({ metricsFile, worldMinute: final.worldMinute, revision: final.revision, archiveBytes: final.archiveBytes })}\n`);
}
