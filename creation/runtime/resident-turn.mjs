import { randomUUID } from 'node:crypto';
import { observeResident, verifyDecision, buildResidentMessages } from '../../residents/actor.mjs';
import { parseGeneratedJSON } from '../../model/generated-json.mjs';

const messages = {
  cancelled: '这次决定已取消，没有留下未完成的行动。',
  'stale-basis': '世界已经发生变化，旧决定没有执行。',
  blocked: '世界已暂停或正在等待，决定没有执行。',
  'invalid-decision': '居民没有给出可执行的决定，世界保持原状。',
  truncated: '模型服务没有生成完整决定，世界保持原状。',
  'network-error': '模型连接中断；可以取消自主生活或明确重试。',
  'http-error': '模型服务拒绝了请求，没有自动重试。',
};

export function createResidentTurn({ runtime, requests, requestModel, state, persist, saveCommit, afterTurn }) {
  return async ({ actorId = runtime.autonomy.nextActorId } = {}, { onProgress, signal } = {}) => {
    if (runtime.active) return { ok: false, reason: 'busy', message: '另一位居民正在决定，没有重复调用。', state: state() };
    if (!Object.hasOwn(runtime.ledgers, actorId)) return { ok: false, reason: 'unknown-actor', message: '找不到这位居民。', state: state() };
    if (runtime.sim.view(1).waiting) return { ok: false, reason: 'blocked', message: '请先解除等待。', state: state() };

    const target = runtime.sim;
    const start = target.view(1);
    const originalLedgers = runtime.ledgers;
    const epoch = runtime.controlEpoch;
    const observation = observeResident(start, actorId);
    const job = requests.start('resident', { signal, onProgress });
    const request = { kind: 'resident', instanceId: start.instanceId, actorId, session: job, disabled: false };
    runtime.active = request;
    runtime.model.pending = true;
    runtime.model.actorId = actorId;
    runtime.model.kind = 'resident';
    const publish = progress => job.publish(progress);
    publish({ phase: 'connecting', elapsedMs: 0, eventsReceived: 0, outputCharacters: 0, preview: '' });
    let result = { ok: false, reason: 'request-failed' };
    try {
      persist();
      const response = await requestModel({ role: 'resident', metadata: { actorId },
        messages: buildResidentMessages(start, actorId, originalLedgers, runtime.genesis),
        signal: job.signal, onProgress: publish });
      if (!response.ok) result = { ok: false, reason: response.audit.error?.code ?? 'request-failed' };
      else if (job.signal.aborted) result = { ok: false, reason: 'cancelled' };
      else if (runtime.sim !== target || target.view(1).revision !== start.revision) result = { ok: false, reason: 'stale-basis' };
      else if (target.view(1).paused && (!start.paused || runtime.controlEpoch !== epoch)) result = { ok: false, reason: 'blocked' };
      else {
        publish({ ...job.progress, phase: 'verifying' });
        let proposal;
        try { proposal = parseGeneratedJSON(response.content).value; } catch { /* Strict validator rejects it. */ }
        const checked = verifyDecision(proposal, observation);
        if (!checked.ok) result = checked;
        else {
          const next = target.copy();
          if (next.view(1).paused) next.resume();
          const id = `resident-${randomUUID()}`;
          const outcome = next.act(checked.decision.action, { actorId, source: 'resident', decisionId: id });
          const advanced = next.advanceWorld(1);
          if (!advanced.ok) result = { ok: false, reason: advanced.reason ?? 'blocked' };
          else {
            if (start.paused && epoch === runtime.controlEpoch) next.pause();
            const after = next.view(1);
            const entry = { id, actorId, observation, decision: checked.decision,
              outcome: { ok: outcome.ok, reason: outcome.reason ?? null, message: outcome.message ?? null },
              after: observeResident(after, actorId),
              source: { instanceId: start.instanceId, fromRevision: start.revision, toRevision: after.revision,
                fromMinute: start.worldMinute, toMinute: after.worldMinute } };
            const nextLedgers = structuredClone(runtime.ledgers);
            nextLedgers[actorId].entries.push(entry);
            nextLedgers[actorId].lastDecision = entry;
            result = { ok: true, message: outcome.ok ? `${observation.name}已经行动，这段经历已保存。` : `${observation.name}的尝试没有成功，实际结果已记入经历。` };
            const nextAutonomy = structuredClone(runtime.autonomy);
            const ids = after.world.actors.map((actor) => actor.id);
            nextAutonomy.nextActorId = ids[(ids.indexOf(actorId) + 1) % ids.length];
            const lastResult = { ...result, actorId, at: new Date().toISOString() };
            // Save the world and its matching memory before publishing either in memory.
            saveCommit({ simulation: next, ledgers: nextLedgers, autonomy: nextAutonomy, lastResult });
            runtime.sim = next;
            runtime.ledgers = nextLedgers;
            runtime.autonomy = nextAutonomy;
          }
        }
      }
    } catch {
      result = { ok: false, reason: 'configuration-or-save-error', message: '模型调用或本地保存未完成，没有自动重试。' };
    } finally {
      job.finish();
      runtime.active = null;
      runtime.model.pending = false;
      runtime.model.actorId = null;
      if (!runtime.sim.view(1).paused) { runtime.sim.pause(); runtime.sim.resume(); }
      runtime.sim.sampleWall(performance.now());
      afterTurn(runtime.sim.view(1).speed);
    }
    if (runtime.sim.view(1).instanceId === start.instanceId) {
      if (!result.ok && !(request.disabled && result.reason === 'cancelled')) {
        runtime.autonomy.waitingReason = result.reason;
        if (runtime.autonomy.enabled) runtime.sim.wait(`actor:${result.reason}`);
      }
      const ids = runtime.sim.view(1).world.actors.map((actor) => actor.id);
      if (result.ok) runtime.autonomy.nextActorId = ids[(ids.indexOf(actorId) + 1) % ids.length];
      runtime.model.lastResult = { ...result, actorId, at: new Date().toISOString(),
        message: result.message ?? messages[result.reason] ?? '决定尚未完成；世界没有改变。' };
    }
    persist();
    return { ok: result.ok, reason: result.reason,
      message: result.message ?? messages[result.reason] ?? '这次决定未完成。', state: state() };
  };
}
