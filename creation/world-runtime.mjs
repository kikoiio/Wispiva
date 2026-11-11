import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { exists, appendAudit } from '../storage/files.mjs';
import { CampSimulation } from '../simulation/core.mjs';
import { observeResident, verifyDecision, createLedgers, ledgerView } from '../residents/actor.mjs';
import { loadModelConfig } from '../model/config.mjs';
import { createModelGateway } from './model-gateway.mjs';
import { createRequestSession } from './request-session.mjs';
import { createCampSceneDocument, checkSceneCandidate } from './scene-workshop.mjs';
import { projectVoxelActors } from '../spatial/voxel-bindings.mjs';
import { validateWorldBindings } from '../spatial/world-bindings.js';
import { projectActivity } from '../simulation/activity.mjs';
import { MODEL_REQUEST_TIMEOUT_MS } from './creation-limits.mjs';
import { createResidentTurn } from './runtime/resident-turn.mjs';
import { createSceneEdit } from './runtime/scene-edit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => structuredClone(value);

export function createCampExperience({ stateFile = join(root, '.data/prototype/state.json'),
  configLoader = loadModelConfig, fetchImpl = globalThis.fetch, requestTimeoutMs = MODEL_REQUEST_TIMEOUT_MS } = {}) {
  let sim = exists(stateFile) ? CampSimulation.load(stateFile) : new CampSimulation();
  let ledgers = createLedgers(sim.view(1).world);
  let autonomy = { enabled: false, waitingReason: null, nextActorId: sim.view(1).world.actors[0].id };
  const model = { pending: false, actorId: null, progress: null, lastResult: null };
  const restoredSnapshot = sim.snapshot();
  const restored = restoredSnapshot.experience;
  const genesis = restored?.genesis ?? null;
  let recovery = restored?.recovery ?? null;
  const generatedWorld = sim.view(1).world.profile === 'generated-world';
  const sceneIsValid = document => document?.profile === (generatedWorld ? 'world' : 'beast-camp') && checkSceneCandidate(document).ok && validateWorldBindings(sim.view(1).world, document).length === 0;
  let sceneState = { document: generatedWorld ? null : createCampSceneDocument(), revision: 0, draft: null, lastResult: null };
  if (restored?.scene) {
    const saved = restored.scene;
    if (Number.isSafeInteger(saved.revision) && saved.revision >= 0 && sceneIsValid(saved.document)) {
      sceneState = { document: clone(saved.document), revision: saved.revision, draft: null, lastResult: saved.lastResult ?? null };
      if (saved.draft?.baseSceneRevision === saved.revision && typeof saved.draft.id === 'string' && sceneIsValid(saved.draft.document)) sceneState.draft = clone(saved.draft);
    } else sceneState.lastResult = { ok: false, message: '保存的场景未通过检查。', recovery: clone(saved) };
  }
  if (generatedWorld && !sceneState.document && genesis?.scene && sceneIsValid(genesis.scene)) {
    sceneState.document = clone(genesis.scene); sceneState.lastResult = { ok: false, message: '当前造型未通过检查，已恢复这个世界的起源造型；旅途与经历保留。', recovery: clone(restored?.scene ?? null) };
  }
  function validEntry(entry, actorId) {
    try {
      const from = restoredSnapshot.history[entry.source.fromRevision];
      const to = restoredSnapshot.history[entry.source.toRevision];
      return entry.actorId === actorId && entry.source.instanceId === restoredSnapshot.instanceId
        && entry.source.toMinute === entry.source.fromMinute + 1
        && from && to && typeof entry.outcome.ok === 'boolean'
        && from.worldMinute === entry.source.fromMinute && to.worldMinute === entry.source.toMinute
        && entry.source.toRevision > entry.source.fromRevision
        && verifyDecision(entry.decision, entry.observation).ok
        && isDeepStrictEqual(entry.observation, observeResident(from, actorId))
        && isDeepStrictEqual(entry.after, observeResident(to, actorId));
    } catch { return false; }
  }
  if (restored?.ledgers) {
    const ids = Object.keys(ledgers);
    if (isDeepStrictEqual(Object.keys(restored.ledgers).sort(), [...ids].sort())
      && ids.every((id) => Array.isArray(restored.ledgers[id]?.entries)
      && restored.ledgers[id].entries.every((entry) => validEntry(entry, id)))) {
      ledgers = clone(restored.ledgers);
      for (const ledger of Object.values(ledgers)) ledger.lastDecision = ledger.entries.at(-1) ?? null;
      if (typeof restored.autonomy?.enabled === 'boolean' && ids.includes(restored.autonomy.nextActorId)) autonomy = clone(restored.autonomy);
    } else {
      recovery = clone(restored.ledgers); autonomy.waitingReason = 'invalid-saved-memory';
    }
    model.lastResult = restored.lastResult ?? null;
    if (restored.pending && restored.pendingKind !== 'scene') { autonomy.waitingReason = 'interrupted'; sim.wait('actor:interrupted'); }
    if (restored.pending && restored.pendingKind === 'scene') sceneState.lastResult = { ok: false, message: '上次场景生成中断，没有自动重试。' };
  }
  if (generatedWorld && !sceneState.document) { autonomy.waitingReason = 'invalid-saved-scene'; sim.wait('scene:invalid'); sceneState.lastResult = { ok: false, message: '这个世界的场景无法恢复，已暂停并保留存档。可从创建页选择其他世界。', recovery: clone(restored?.scene ?? null) }; }
  if (generatedWorld && sceneState.document && sim.view(1).waiting === 'scene:invalid') { sim.retry(); if (autonomy.waitingReason === 'invalid-saved-scene') autonomy.waitingReason = null; }
  let active = null;
  let controlEpoch = 0;
  let nextAt = 0;
  let savedAt = performance.now();
  let savedRevision = sim.view(1).revision;
  const requests = createRequestSession();
  const runtime = {
    get sim() { return sim; }, set sim(value) { sim = value; },
    get ledgers() { return ledgers; }, set ledgers(value) { ledgers = value; },
    get autonomy() { return autonomy; }, set autonomy(value) { autonomy = value; },
    get sceneState() { return sceneState; }, set sceneState(value) { sceneState = value; },
    get recovery() { return recovery; }, set recovery(value) { recovery = value; },
    genesis, model,
    get active() { return active; }, set active(value) { active = value; },
    get controlEpoch() { return controlEpoch; }, set controlEpoch(value) { controlEpoch = value; },
  };
  const modelGateway = createModelGateway({ configLoader, fetchImpl, requestTimeoutMs,
    audit: entry => appendAudit(join(dirname(stateFile), 'model-calls.jsonl'), entry),
    auditMapper: (role, audit, metadata) => ({ role, ...(metadata ?? {}), ...audit }),
  });
  const requestModel = request => modelGateway.connect()(request);
  const persist = () => {
    sim.save(stateFile, { experience: { ledgers, autonomy, lastResult: model.lastResult, recovery, genesis, scene: sceneState, pendingKind: active?.kind ?? null,
      pending: Boolean(active && active.instanceId === sim.view(1).instanceId && !active.session.signal.aborted) } });
    savedAt = performance.now(); savedRevision = sim.view(1).revision;
  };
  const state = () => {
    const view = sim.view(120);
    const progress = requests.snapshot().progress;
    return { instanceId: view.instanceId, worldMinute: view.worldMinute, revision: view.revision, paused: view.paused, speed: view.speed, waiting: view.waiting, genesis: clone(genesis),
      world: view.world, events: view.history.slice(-30), actors: ledgerView(ledgers), observations:Object.fromEntries(view.world.actors.map(a=>[a.id,observeResident(view,a.id)])), autonomy: clone(autonomy), scene: clone(sceneState),
      activity: projectActivity(view, ledgers),
      voxelActors: genesis?.voxel ? projectVoxelActors({ world: view.world, voxel: genesis.voxel }) : [],
      model: { ...clone(model), progress: model.pending && progress ? { ...progress, elapsedMs: performance.now() - active.session.startedAt } : null } };
  };
  const cancel = ({ disabling = false } = {}) => {
    if (!active) return { ok: false, message: '当前没有等待中的决定。', state: state() };
    active.disabled = disabling;
    if (!disabling && active.kind !== 'scene' && active.instanceId === sim.view(1).instanceId) {
      autonomy.waitingReason = 'cancelled';
      if (autonomy.enabled) sim.wait('actor:cancelled');
    }
    requests.cancel(); persist();
    return { ok: true, message: '已请求取消这次决定。', state: state() };
  };
  const control = (body) => {
    let result; let message = null;
    switch (body?.type) {
      case 'play':
        if (active || autonomy.waitingReason || sim.view(1).waiting) return { ok: false, message: '先结束当前请求或解除等待，再继续生活。', state: state() };
        autonomy.enabled = true; nextAt = 0; controlEpoch++; result = sim.resume(); message = '世界开始继续生活。'; break;
      case 'pause':
        controlEpoch++;
        if (active?.kind === 'resident') { active.disabled = true; requests.cancel(); }
        result = sim.pause(); break;
      case 'resume': controlEpoch++; result = sim.resume(); break;
      case 'speed':
        if (![1, 24, 60, 120].includes(body.speed)) return { ok: false, message: '请选择可用的时间速度。', state: state() };
        result = sim.setSpeed(body.speed); break;
      case 'step': {
        if (active) return { ok: false, message: '居民正在决定，请先等待或取消。', state: state() };
        const duration = body.minutes ?? 1;
        if (!Number.isSafeInteger(duration) || duration < 1 || duration > 60) return { ok: false, message: '快进范围为1至60分钟。', state: state() };
        const wasPaused = sim.view(1).paused;
        const next = sim.copy(); if (wasPaused) next.resume();
        result = next.advanceWorld(duration); if (wasPaused) next.pause();
        if (result.ok) sim = next;
        break;
      }
      case 'action': result = sim.act(body.action, { source: 'author' }); break;
      case 'autonomy':
        if (typeof body.enabled !== 'boolean') return { ok: false, message: '自主生活开关无效。', state: state() };
        if (body.enabled && active?.kind === 'scene') return { ok: false, message: '请先结束场景生成。', state: state() };
        autonomy.enabled = body.enabled; nextAt = 0;
        if (!body.enabled) {
          if (active) cancel({ disabling: true });
          autonomy.waitingReason = null;
          if (sim.view(1).waiting?.startsWith('actor:')) sim.retry();
          if (!sim.view(1).paused) { sim.pause(); sim.resume(); }
        }
        result = { ok: true }; message = body.enabled ? '自主生活已开启，居民会轮流决定。页面关闭后仍会继续；暂停可停止新回合。' : '自主生活已关闭。'; break;
      case 'actor-retry':
        if (active) return { ok: false, message: '上一请求尚未结束。', state: state() };
        autonomy.waitingReason = null; if (sim.view(1).waiting?.startsWith('actor:')) sim.retry();
        sim.pause(); controlEpoch++; nextAt = 0; result = { ok: true }; message = '已解除等待。世界保持暂停，可以下一步或继续播放。'; break;
      case 'save': result = { ok: true }; message = '世界与经历已保存。'; break;
      case 'reset':
        if (active) { active.disabled = true; requests.cancel(); }
        sim = new CampSimulation(); controlEpoch++;
        ledgers = createLedgers(sim.view(1).world); recovery = null;
        autonomy = { enabled: false, waitingReason: null, nextActorId: sim.view(1).world.actors[0].id };
        sceneState = { document: createCampSceneDocument(), revision: sceneState.revision + 1, draft: null, lastResult: null };
        model.lastResult = null; result = { ok: true }; message = '一段新的旅程开始了。'; break;
      case 'scene-apply': {
        if (active) return { ok: false, message: '请先结束当前模型调用。', state: state() };
        const draft = sceneState.draft;
        if (!draft || draft.id !== body.draftId || draft.baseSceneRevision !== sceneState.revision) return { ok: false, message: '这个场景草稿已失效，请重新生成。', state: state() };
        const checked = checkSceneCandidate(draft.document);
        if (!checked.ok) return { ...checked, message: '草稿没有通过编译，当前世界保持原样。', state: state() };
        if (validateWorldBindings(sim.view(1).world, draft.document).length) return { ok: false, message: '造型会阻挡世界地点，不能应用。', state: state() };
        const before = sceneState;
        sceneState = { document: checked.document, revision: before.revision + 1, draft: null, lastResult: { ok: true, message: '新造型已应用并保存。' } };
        try { persist(); } catch (error) { sceneState = before; throw error; }
        return { ok: true, message: '新造型已应用；旅途和居民经历保留。', state: state() };
      }
      case 'scene-discard':
        if (!sceneState.draft || sceneState.draft.id !== body.draftId) return { ok: false, message: '草稿已经变化，请核对当前草稿后再操作。', state: state() };
        sceneState.draft = null; result = { ok: true }; message = '草稿已放弃，继续当前世界。'; break;
      default: return { ok: false, message: '无法识别这个操作。', state: state() };
    }
    if (result.ok) persist();
    return { ...result, message: message ?? result.message ?? (result.ok ? '世界已经改变。' : '这个尝试没有成功。'), state: state() };
  };
  const afterTurn = speed => { nextAt = performance.now() + 60000 / speed; };
  const actorStep = createResidentTurn({ runtime, requests, requestModel, state, persist,
    saveCommit({ simulation, ledgers: nextLedgers, autonomy: nextAutonomy, lastResult }) {
      simulation.save(stateFile, { experience: { ledgers: nextLedgers, autonomy: nextAutonomy, pending: false,
        pendingKind: null, recovery, genesis, scene: sceneState, lastResult } });
    },
    afterTurn,
  });
  const sceneStep = createSceneEdit({ runtime, requests, requestModel, state, persist });
  sim.sampleWall(performance.now());
  const timer = setInterval(() => {
    if (active) return;
    if (autonomy.enabled) {
      const current = sim.view(1);
      if (!current.paused && !current.waiting && !autonomy.waitingReason && performance.now() >= nextAt) {
        void actorStep().catch(() => { autonomy.waitingReason = 'save-error'; sim.wait('actor:save-error'); });
      }
    } else {
      sim.sampleWall(performance.now());
      if (sim.view(1).revision !== savedRevision && performance.now() - savedAt > 3000) { try { persist(); } catch { /* State remains visible in memory. */ } }
    }
  }, 500); timer.unref();
  return { state, control, actorStep, sceneStep, cancelModel: cancel, close() { clearInterval(timer); if (active) cancel(); persist(); } };
}
