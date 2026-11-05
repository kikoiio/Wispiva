import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { exists, appendAudit } from '../storage/files.mjs';
import { CampSimulation } from '../simulation/core.mjs';
import { observeResident, verifyDecision, createLedgers, ledgerView, buildResidentMessages } from '../residents/actor.mjs';
import { loadModelConfig } from '../model/config.mjs';
import { callModel } from '../model/model-client.mjs';
import { createCampSceneDocument, checkSceneCandidate, buildSceneMessages } from './scene-workshop.mjs';
import { projectVoxelActors } from '../spatial/voxel-bindings.mjs';
import { validateWorldBindings } from '../spatial/world-bindings.js';
import { parseGeneratedJSON } from '../model/generated-json.mjs';
import { projectActivity } from '../simulation/activity.mjs';
import { MODEL_REQUEST_TIMEOUT_MS } from './creation-limits.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => structuredClone(value);
const boundedModelConfig = (llm, timeoutMs = MODEL_REQUEST_TIMEOUT_MS) => llm.timeoutMs == null ? { ...llm, timeoutMs } : llm;
const messages = {
  cancelled: '这次决定已取消，没有留下未完成的行动。',
  'stale-basis': '世界已经发生变化，旧决定没有执行。',
  blocked: '世界已暂停或正在等待，决定没有执行。',
  'invalid-decision': '居民没有给出可执行的决定，世界保持原状。',
  truncated: '模型服务没有生成完整决定，世界保持原状。',
  'network-error': '模型连接中断；可以取消自主生活或明确重试。',
  'http-error': '模型服务拒绝了请求，没有自动重试。',
};

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
  const persist = () => {
    sim.save(stateFile, { experience: { ledgers, autonomy, lastResult: model.lastResult, recovery, genesis, scene: sceneState, pendingKind: active?.kind ?? null,
      pending: Boolean(active && active.instanceId === sim.view(1).instanceId && !active.controller.signal.aborted) } });
    savedAt = performance.now(); savedRevision = sim.view(1).revision;
  };
  const state = () => {
    const view = sim.view(120);
    return { instanceId: view.instanceId, worldMinute: view.worldMinute, revision: view.revision, paused: view.paused, speed: view.speed, waiting: view.waiting, genesis: clone(genesis),
      world: view.world, events: view.history.slice(-30), actors: ledgerView(ledgers), observations:Object.fromEntries(view.world.actors.map(a=>[a.id,observeResident(view,a.id)])), autonomy: clone(autonomy), scene: clone(sceneState),
      activity: projectActivity(view, ledgers),
      voxelActors: genesis?.voxel ? projectVoxelActors({ world: view.world, voxel: genesis.voxel }) : [],
      model: { ...clone(model), progress: model.pending && model.progress ? { ...model.progress, elapsedMs: performance.now() - active.startedAt } : null } };
  };
  const cancel = ({ disabling = false } = {}) => {
    if (!active) return { ok: false, message: '当前没有等待中的决定。', state: state() };
    active.disabled = disabling;
    if (!disabling && active.kind !== 'scene' && active.instanceId === sim.view(1).instanceId) {
      autonomy.waitingReason = 'cancelled';
      if (autonomy.enabled) sim.wait('actor:cancelled');
    }
    active.controller.abort(); persist();
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
        if (active?.kind === 'resident') { active.disabled = true; active.controller.abort(); }
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
        if (active) { active.disabled = true; active.controller.abort(); }
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
  const actorStep = async ({ actorId = autonomy.nextActorId } = {}, { onProgress, signal } = {}) => {
    if (active) return { ok: false, reason: 'busy', message: '另一位居民正在决定，没有重复调用。', state: state() };
    if (!Object.hasOwn(ledgers, actorId)) return { ok: false, reason: 'unknown-actor', message: '找不到这位居民。', state: state() };
    if (sim.view(1).waiting) return { ok: false, reason: 'blocked', message: '请先解除等待。', state: state() };
    const target = sim; const start = target.view(1); const originalLedgers = ledgers; const epoch = controlEpoch;
    const observation = observeResident(start, actorId);
    const controller = new AbortController(); const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort();
    const request = { kind: 'resident', instanceId: start.instanceId, controller, startedAt: performance.now(), disabled: false };
    active = request; model.pending = true; model.actorId = actorId; model.kind = 'resident';
    const publish = (progress) => {
      model.progress = progress;
      try { onProgress?.(progress); } catch { /* Disconnect is handled through signal. */ }
    };
    publish({ phase: 'connecting', elapsedMs: 0, eventsReceived: 0, outputCharacters: 0, preview: '' });
    let result = { ok: false, reason: 'request-failed' };
    try {
      persist();
      const { llm } = configLoader();
      const response = await callModel({ llm: boundedModelConfig(llm, requestTimeoutMs), messages: buildResidentMessages(start, actorId, originalLedgers, genesis), fetchImpl,
        signal: controller.signal, onProgress: publish });
      appendAudit(join(dirname(stateFile), 'model-calls.jsonl'), { role: 'resident', actorId, ...response.audit });
      if (!response.ok) result = { ok: false, reason: response.audit.error?.code ?? 'request-failed' };
      else if (controller.signal.aborted) result = { ok: false, reason: 'cancelled' };
      else if (sim !== target || target.view(1).revision !== start.revision) result = { ok: false, reason: 'stale-basis' };
      else if (target.view(1).paused && (!start.paused || controlEpoch !== epoch)) result = { ok: false, reason: 'blocked' };
      else {
        publish({ ...model.progress, phase: 'verifying' });
        let proposal; try { proposal = parseGeneratedJSON(response.content).value; } catch { /* Strict validator rejects it. */ }
        const checked = verifyDecision(proposal, observation);
        if (!checked.ok) result = checked;
        else {
          const next = target.copy(); if (next.view(1).paused) next.resume();
          const id = `resident-${randomUUID()}`;
          const outcome = next.act(checked.decision.action, { actorId, source: 'resident', decisionId: id });
          const advanced = next.advanceWorld(1);
          if (!advanced.ok) result = { ok: false, reason: advanced.reason ?? 'blocked' };
          else {
            if (start.paused && epoch === controlEpoch) next.pause();
            const after = next.view(1);
            const entry = { id, actorId, observation, decision: checked.decision,
              outcome: { ok: outcome.ok, reason: outcome.reason ?? null, message: outcome.message ?? null }, after: observeResident(after, actorId),
              source: { instanceId: start.instanceId, fromRevision: start.revision, toRevision: after.revision, fromMinute: start.worldMinute, toMinute: after.worldMinute } };
            const nextLedgers = clone(ledgers); nextLedgers[actorId].entries.push(entry); nextLedgers[actorId].lastDecision = entry;
            result = { ok: true, message: outcome.ok ? `${observation.name}已经行动，这段经历已保存。` : `${observation.name}的尝试没有成功，实际结果已记入经历。` };
            // Persist the pair before exposing a changed authoritative world.
            const nextAutonomy = clone(autonomy);
            const ids = after.world.actors.map((actor) => actor.id);
            nextAutonomy.nextActorId = ids[(ids.indexOf(actorId) + 1) % ids.length];
            next.save(stateFile, { experience: { ledgers: nextLedgers, autonomy: nextAutonomy, pending: false, pendingKind: null, recovery, genesis, scene: sceneState,
              lastResult: { ...result, actorId, at: new Date().toISOString() } } });
            sim = next; ledgers = nextLedgers; autonomy = nextAutonomy;
          }
        }
      }
    } catch {
      result = { ok: false, reason: 'configuration-or-save-error', message: '模型调用或本地保存未完成，没有自动重试。' };
    } finally {
      signal?.removeEventListener('abort', abort);
      active = null; model.pending = false; model.actorId = null;
      if (!sim.view(1).paused) { sim.pause(); sim.resume(); }
      sim.sampleWall(performance.now()); nextAt = performance.now() + 60000 / sim.view(1).speed;
    }
    if (sim.view(1).instanceId === start.instanceId) {
      if (!result.ok && !(request.disabled && result.reason === 'cancelled')) {
        autonomy.waitingReason = result.reason; if (autonomy.enabled) sim.wait(`actor:${result.reason}`);
      }
      const ids = sim.view(1).world.actors.map((actor) => actor.id);
      if (result.ok) autonomy.nextActorId = ids[(ids.indexOf(actorId) + 1) % ids.length];
      model.lastResult = { ...result, actorId, at: new Date().toISOString(), message: result.message ?? messages[result.reason] ?? '决定尚未完成；世界没有改变。' };
    }
    persist();
    return { ok: result.ok, reason: result.reason, message: result.message ?? messages[result.reason] ?? '这次决定未完成。', state: state() };
  };
  const sceneStep = async ({ instruction } = {}, { onProgress, signal } = {}) => {
    if (!sceneState.document) return { ok: false, message: '当前场景无法恢复，先从创建页选择世界。', state: state() };
    if (active || autonomy.enabled) return { ok: false, reason: 'busy', message: '请先关闭自主生活并结束当前调用，再修改世界。', state: state() };
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 4000) return { ok: false, reason: 'invalid-instruction', message: '请用简短文字描述想改变的造型。', state: state() };
    const instanceId = sim.view(1).instanceId, baseSceneRevision = sceneState.revision;
    const controller = new AbortController(); const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    active = { kind: 'scene', instanceId, controller, startedAt: performance.now(), disabled: false };
    model.pending = true; model.actorId = null; model.kind = 'scene';
    const publish = (progress) => { model.progress = progress; try { onProgress?.(progress); } catch { /* disconnected consumers abort through signal */ } };
    publish({ phase: 'connecting', elapsedMs: 0, eventsReceived: 0, outputCharacters: 0, preview: '' });
    let result = { ok: false, reason: 'request-failed', message: '场景生成未完成，没有自动重试。' };
    try {
      persist();
      const { llm } = configLoader();
      const response = await callModel({ llm: boundedModelConfig(llm, requestTimeoutMs), messages: buildSceneMessages(instruction.trim(), sceneState.document), fetchImpl, signal: controller.signal, onProgress: publish });
      appendAudit(join(dirname(stateFile), 'model-calls.jsonl'), { role: 'scene-design', ...response.audit });
      if (controller.signal.aborted) result = { ok: false, reason: 'cancelled', message: '场景生成已取消，当前世界保持原样。' };
      else if (!response.ok) result = { ok: false, reason: response.audit.error?.code ?? 'request-failed', message: '模型没有返回完整场景，没有自动重试。' };
      else if (sim.view(1).instanceId !== instanceId || sceneState.revision !== baseSceneRevision) result = { ok: false, reason: 'stale-basis', message: '世界已变化，旧草稿未保留。' };
      else {
        publish({ ...model.progress, phase: 'verifying' });
        let document; try { document = JSON.parse(response.content); } catch { /* validator supplies diagnostics */ }
        const checked = checkSceneCandidate(document);
        if (!checked.ok) result = { ...checked, message: '模型场景未通过结构、空间或编译检查，当前世界保持原样。' };
        else if (validateWorldBindings(sim.view(1).world, document).length) result = { ok: false, reason: 'scene-binding-changed', diagnostics: validateWorldBindings(sim.view(1).world, document), message: '造型会阻挡世界中的地点，草稿未保留。' };
        else if (sceneState.document.profile === 'world' && (document.profile !== 'world'
          || !isDeepStrictEqual(document.objects.map(o => o.id).sort(), sceneState.document.objects.map(o => o.id).sort())
          || sceneState.document.objects.filter(o => o.kind === 'character').some(old => {
            const next = document.objects.find(o => o.id === old.id);
            return next?.kind !== 'character' || !isDeepStrictEqual(next.position, old.position);
          }))) result = { ok: false, reason: 'scene-binding-changed', message: '造型编辑不能删除世界物件或改变人物绑定，草稿未保留。' };
        else {
          sceneState.draft = { id: randomUUID(), baseSceneRevision, document: checked.document, instruction: instruction.trim(), createdAt: new Date().toISOString() };
          result = { ok: true, message: '草稿已校验，可预览后应用。' };
        }
      }
    } catch { result = { ok: false, reason: 'configuration-or-save-error', message: '场景生成或保存未完成，没有自动重试。' }; }
    finally {
      signal?.removeEventListener('abort', abort);
      active = null; model.pending = false; model.actorId = null;
      if (!sim.view(1).paused) { sim.pause(); sim.resume(); }
      if (sim.view(1).instanceId === instanceId) {
        sceneState.lastResult = { ...result, at: new Date().toISOString() };
        model.lastResult = { ...result, kind: 'scene', at: new Date().toISOString() };
      }
      persist();
    }
    return { ...result, state: state() };
  };
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
