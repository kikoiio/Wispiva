import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { checkSceneCandidate, buildSceneMessages } from '../scene-workshop.mjs';
import { validateWorldBindings } from '../../spatial/world-bindings.js';

export function createSceneEdit({ runtime, requests, requestModel, state, persist }) {
  return async ({ instruction } = {}, { onProgress, signal } = {}) => {
    if (!runtime.sceneState.document) return { ok: false, message: '当前场景无法恢复，先从创建页选择世界。', state: state() };
    if (runtime.active || runtime.autonomy.enabled) return { ok: false, reason: 'busy', message: '请先关闭自主生活并结束当前调用，再修改世界。', state: state() };
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 4000) return { ok: false, reason: 'invalid-instruction', message: '请用简短文字描述想改变的造型。', state: state() };

    const instanceId = runtime.sim.view(1).instanceId;
    const baseSceneRevision = runtime.sceneState.revision;
    const job = requests.start('scene', { signal, onProgress });
    runtime.active = { kind: 'scene', instanceId, session: job, disabled: false };
    runtime.model.pending = true;
    runtime.model.actorId = null;
    runtime.model.kind = 'scene';
    const publish = progress => job.publish(progress);
    publish({ phase: 'connecting', elapsedMs: 0, eventsReceived: 0, outputCharacters: 0, preview: '' });
    let result = { ok: false, reason: 'request-failed', message: '场景生成未完成，没有自动重试。' };
    try {
      persist();
      const response = await requestModel({ role: 'scene-design',
        messages: buildSceneMessages(instruction.trim(), runtime.sceneState.document),
        signal: job.signal, onProgress: publish });
      if (job.signal.aborted) result = { ok: false, reason: 'cancelled', message: '场景生成已取消，当前世界保持原样。' };
      else if (!response.ok) result = { ok: false, reason: response.audit.error?.code ?? 'request-failed', message: '模型没有返回完整场景，没有自动重试。' };
      else if (runtime.sim.view(1).instanceId !== instanceId || runtime.sceneState.revision !== baseSceneRevision) result = { ok: false, reason: 'stale-basis', message: '世界已变化，旧草稿未保留。' };
      else {
        publish({ ...job.progress, phase: 'verifying' });
        let document;
        try { document = JSON.parse(response.content); } catch { /* validator supplies diagnostics */ }
        const checked = checkSceneCandidate(document);
        if (!checked.ok) result = { ...checked, message: '模型场景未通过结构、空间或编译检查，当前世界保持原样。' };
        else {
          const bindingDiagnostics = validateWorldBindings(runtime.sim.view(1).world, document);
          if (bindingDiagnostics.length) result = { ok: false, reason: 'scene-binding-changed', diagnostics: bindingDiagnostics, message: '造型会阻挡世界中的地点，草稿未保留。' };
          else if (runtime.sceneState.document.profile === 'world' && (document.profile !== 'world'
            || !isDeepStrictEqual(document.objects.map(o => o.id).sort(), runtime.sceneState.document.objects.map(o => o.id).sort())
            || runtime.sceneState.document.objects.filter(o => o.kind === 'character').some(old => {
              const next = document.objects.find(o => o.id === old.id);
              return next?.kind !== 'character' || !isDeepStrictEqual(next.position, old.position);
            }))) result = { ok: false, reason: 'scene-binding-changed', message: '造型编辑不能删除世界物件或改变人物绑定，草稿未保留。' };
          else {
            runtime.sceneState.draft = { id: randomUUID(), baseSceneRevision, document: checked.document,
              instruction: instruction.trim(), createdAt: new Date().toISOString() };
            result = { ok: true, message: '草稿已校验，可预览后应用。' };
          }
        }
      }
    } catch {
      result = { ok: false, reason: 'configuration-or-save-error', message: '场景生成或保存未完成，没有自动重试。' };
    } finally {
      job.finish();
      runtime.active = null;
      runtime.model.pending = false;
      runtime.model.actorId = null;
      if (!runtime.sim.view(1).paused) { runtime.sim.pause(); runtime.sim.resume(); }
      if (runtime.sim.view(1).instanceId === instanceId) {
        runtime.sceneState.lastResult = { ...result, at: new Date().toISOString() };
        runtime.model.lastResult = { ...result, kind: 'scene', at: new Date().toISOString() };
      }
      persist();
    }
    return { ...result, state: state() };
  };
}
