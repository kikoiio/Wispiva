import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWorldCreation } from '../world-creation.mjs';
import { loadModelConfig } from '../model/config.mjs';
import { inspectVoxelSpaces } from '../geometry/voxel-inspection.js';

const outputRoot = resolve('.tmp/live-model-loop');
mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
const runDirectory = mkdtempSync(join(outputRoot, 'run-'));
const reportFile = join(runDirectory, 'report.json');
const reports = [];

function saveReport(status, extra = {}) {
  writeFileSync(reportFile, `${JSON.stringify({ status, attempts: reports, ...extra }, null, 2)}\n`, { mode: 0o600 });
}

function voxelKey(position) {
  return position.join(',');
}

function failure(attempt, stage, reason, details = {}) {
  return { attempt, passed: false, stage, reason, ...details };
}

function removeAndPersistOneFloorCell(directory) {
  const creationFile = join(directory, 'creation.json');
  const saved = JSON.parse(readFileSync(creationFile, 'utf8'));
  const snapshot = structuredClone(saved.voxelSnapshot);
  if (!snapshot || snapshot.revision !== saved.voxelRevision) throw new Error('saved-voxel-revision-mismatch');
  const building = snapshot.objects.find(object => object.kind === 'building');
  if (!building) throw new Error('missing-building-object');

  const occupied = new Map(snapshot.cells.map(cell => [voxelKey(cell.position), cell.material]));
  const target = snapshot.cells.find(cell => {
    const [x, y, z] = cell.position;
    if (y !== building.from[1] || x <= building.from[0] || x >= building.to[0] || z <= building.from[2] || z >= building.to[2]) return false;
    return [[x - 1, y, z], [x + 1, y, z], [x, y, z - 1], [x, y, z + 1]]
      .filter(([nx, , nz]) => nx > building.from[0] && nx < building.to[0] && nz > building.from[2] && nz < building.to[2])
      .map(position => occupied.get(voxelKey(position)))
      .every(material => material === cell.material);
  });
  if (!target) throw new Error('no-repairable-interior-floor-cell');

  const targetKey = voxelKey(target.position);
  snapshot.cells = snapshot.cells.filter(cell => voxelKey(cell.position) !== targetKey);
  for (const object of snapshot.objects) {
    if (Array.isArray(object.members)) object.members = object.members.filter(position => voxelKey(position) !== targetKey);
  }
  snapshot.revision++;
  snapshot.undo = [];
  snapshot.redo = [];
  const inspection = inspectVoxelSpaces(snapshot);
  if (inspection.issues.length !== 1 || inspection.issues[0].code !== 'floor-gap' || inspection.issues[0].objectId !== building.id) {
    throw new Error('injected-gap-did-not-produce-one-floor-gap-diagnostic');
  }
  saved.voxelRevision = snapshot.revision;
  saved.voxelSnapshot = snapshot;
  saved.pending = false;
  delete saved.pendingKind;
  const temporary = `${creationFile}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(saved)}\n`, { mode: 0o600 });
  renameSync(temporary, creationFile);
  return { target: target.position, injectedRevision: snapshot.revision, cells: snapshot.cells.length };
}

async function runAttempt(attemptNumber, expectedModel) {
  const directory = mkdtempSync(join(runDirectory, `attempt-${attemptNumber}-`));
  const stateFile = join(directory, 'state.json');
  let experience = null;
  try {
    experience = createWorldCreation({ stateFile, configLoader: loadModelConfig });
    const buildStartedAt = Date.now();
    const build = await experience.discussStep({
      mode: 'loop',
      message: '在空白场景里自动建造一间紧凑、可进入的湖边木屋，包含木地板、四周墙、两格高门洞、坡屋顶和门外支撑地面。先完成简单、可检查的结构，不要复杂装饰。',
    });
    const buildElapsedMs = Date.now() - buildStartedAt;
    const buildVoxel = build.state.creation.voxel;
    const buildCalls = build.attempt?.timings?.calls ?? [];
    const models = [...new Set(buildCalls.map(call => call.model).filter(Boolean))];
    const buildDiagnostics = inspectVoxelSpaces(buildVoxel).issues;
    if (!build.ok) return failure(attemptNumber, 'build', build.reason ?? 'build-not-complete', {
      model: expectedModel, models, calls: buildCalls.length, requestSent: buildCalls.some(call => call.requestSent),
      elapsedMs: buildElapsedMs, revision: buildVoxel.revision,
      cells: buildVoxel.cells.length, objects: buildVoxel.objects.length, diagnosticCount: buildDiagnostics.length,
    });
    if (!buildCalls.length || models.length !== 1 || models[0] !== expectedModel) return failure(attemptNumber, 'model-identity', 'unexpected-model-or-no-model-call', {
      model: expectedModel, models, calls: buildCalls.length, requestSent: buildCalls.some(call => call.requestSent), elapsedMs: buildElapsedMs,
    });
    if (!buildVoxel.cells.length || !buildVoxel.objects.some(object => object.kind === 'building') || buildDiagnostics.length) {
      return failure(attemptNumber, 'build-validation', 'empty-or-diagnosed-building', {
        model: expectedModel, models, calls: buildCalls.length, requestSent: buildCalls.some(call => call.requestSent),
        elapsedMs: buildElapsedMs, revision: buildVoxel.revision,
        cells: buildVoxel.cells.length, objects: buildVoxel.objects.length, diagnosticCount: buildDiagnostics.length,
      });
    }

    const builtRevision = buildVoxel.revision;
    const builtCells = buildVoxel.cells.length;
    experience.close();
    experience = null;

    const reloaded = createWorldCreation({ stateFile, configLoader: loadModelConfig });
    const reloadedVoxel = reloaded.state().creation.voxel;
    const reloadMatched = reloadedVoxel.revision === builtRevision && reloadedVoxel.cells.length === builtCells &&
      inspectVoxelSpaces(reloadedVoxel).issues.length === 0;
    reloaded.close();
    if (!reloadMatched) return failure(attemptNumber, 'build-reload', 'built-scene-did-not-survive-reload', {
      model: expectedModel, models, calls: buildCalls.length, builtRevision, reloadRevision: reloadedVoxel.revision,
      builtCells, reloadCells: reloadedVoxel.cells.length,
    });

    const gap = removeAndPersistOneFloorCell(directory);
    experience = createWorldCreation({ stateFile, configLoader: loadModelConfig });
    const beforeRepair = experience.state().creation.voxel;
    const repairStartedAt = Date.now();
    const repair = await experience.discussStep({
      mode: 'loop',
      maxIterations: 2,
      message: '检查木屋并修复唯一一处有明确诊断的地板缺口，保留其余结构。',
    });
    const repairElapsedMs = Date.now() - repairStartedAt;
    const repairIteration = repair.attempt?.loop?.iterations?.find(iteration => iteration.repair?.code === 'floor-gap');
    const repairedVoxel = repair.state.creation.voxel;
    const repairCalls = repair.attempt?.timings?.calls?.length ?? 0;
    const repairPassed = repair.ok && repairCalls === 0 && repairIteration?.repair?.method === 'deterministic' &&
      repairedVoxel.revision === beforeRepair.revision + 1 && inspectVoxelSpaces(repairedVoxel).issues.length === 0;
    if (!repairPassed) return failure(attemptNumber, 'repair', repair.reason ?? 'floor-gap-repair-did-not-converge', {
      model: expectedModel, models, buildCalls: buildCalls.length, repairCalls, repairElapsedMs,
      injectedRevision: gap.injectedRevision, repairRevision: repairedVoxel.revision,
      diagnosticCount: inspectVoxelSpaces(repairedVoxel).issues.length,
    });

    const finalRevision = repairedVoxel.revision;
    const finalCells = repairedVoxel.cells.length;
    experience.close();
    experience = null;
    const finalReload = createWorldCreation({ stateFile, configLoader: loadModelConfig });
    const finalVoxel = finalReload.state().creation.voxel;
    const finalIssues = inspectVoxelSpaces(finalVoxel).issues.length;
    const persisted = finalVoxel.revision === finalRevision && finalVoxel.cells.length === finalCells && finalIssues === 0;
    finalReload.close();
    if (!persisted) return failure(attemptNumber, 'repair-reload', 'repaired-scene-did-not-survive-reload', {
      model: expectedModel, models, buildCalls: buildCalls.length, repairCalls,
      finalRevision, reloadedRevision: finalVoxel.revision, finalCells, reloadedCells: finalVoxel.cells.length,
      diagnosticCount: finalIssues,
    });

    return {
      attempt: attemptNumber, passed: true, model: expectedModel, models, buildCalls: buildCalls.length,
      requestSent: buildCalls.some(call => call.requestSent),
      buildElapsedMs, builtRevision, builtCells, objects: buildVoxel.objects.length, injectedGap: gap.target,
      injectedRevision: gap.injectedRevision, repairMethod: repairIteration.repair.method,
      repairCalls, repairElapsedMs, finalRevision, finalCells, finalDiagnosticCount: finalIssues,
    };
  } catch (error) {
    return failure(attemptNumber, 'harness', error?.code ?? 'harness-error');
  } finally {
    try { experience?.close(); } catch { /* The isolated attempt is discarded below. */ }
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  let config;
  let repetitions;
  try {
    config = loadModelConfig();
    repetitions = Number(process.env.LIVE_MODEL_REPETITIONS ?? '3');
    if (![1, 3].includes(repetitions)) throw new Error('LIVE_MODEL_REPETITIONS must be 1 or 3');
  } catch (error) {
    const report = { status: 'configuration-error', reason: error.message };
    saveReport(report.status, { reason: report.reason });
    console.log(JSON.stringify(report));
    process.exitCode = 1;
    return;
  }

  for (let attempt = 1; attempt <= repetitions; attempt++) {
    const report = await runAttempt(attempt, config.llm.model);
    reports.push(report);
    saveReport(report.passed ? 'running' : 'failed', { configuredModel: config.llm.model });
    console.log(JSON.stringify(report));
    if (!report.passed) {
      saveReport('failed', { configuredModel: config.llm.model });
      process.exitCode = 1;
      return;
    }
  }

  saveReport('passed', { configuredModel: config.llm.model });
}

await main();
