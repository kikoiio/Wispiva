import { randomUUID } from 'node:crypto';
import { retrieveSource } from '../../model/source-retrieval.mjs';
import { bindVoxelWorld } from '../../spatial/voxel-bindings.mjs';
import { checkWorldCandidate, buildGenesisMessages } from '../world-genesis.mjs';
import { parseGenesisOutput, compileGenesisRecords, GENESIS_STAGES, readGenesisStage } from '../genesis-records.mjs';
import { invalidateGeneration } from '../recovery.mjs';
const clone = value => structuredClone(value);

export function createGenesisFlow({ workspace, requests, models, blocked, response, state }) {
  return async ({ description, conversationRevision, retryGenerationId, authorRequested = false } = {}, { onProgress, signal } = {}) => {
    const creation = workspace.creation, voxel = workspace.voxel;
    const persist = () => workspace.save();
    if (blocked() || creation.mode !== 'create') return response(false, '请先进入创建页并结束当前调用。', { reason: 'busy' });
    if (voxel.state().error) return response(false, voxel.state().error, { reason: 'voxel-recovery' });
    const conversational = creation.dialogue.messages.length > 0 || conversationRevision !== undefined;
    if (conversational) {
      if (conversationRevision !== creation.dialogue.revision || !creation.dialogue.summary.trim() || !creation.dialogue.messages.some(m => m.role === 'user') || !creation.dialogue.ready && authorRequested !== true) return response(false, '先保存起点想法，再选择查看当前设定的草稿。', { reason: 'discussion-required' });
      description = creation.dialogue.summary;
    }
    if (typeof description !== 'string' || !description.trim() || description.length > 8000) return response(false, '写下一段想要的世界，再开始创建。', { reason: 'invalid-description' });
    const oldGeneration = creation.generation;
    if (retryGenerationId && (!oldGeneration || oldGeneration.id !== retryGenerationId || !['failed', 'cancelled'].includes(oldGeneration.outcome) || oldGeneration.description !== description.trim() || oldGeneration.conversationRevision !== creation.dialogue.revision || oldGeneration.voxelId !== creation.voxelId || oldGeneration.voxelRevision !== voxel.state().revision)) return response(false, '起点基准已经变化，请根据当前设定重新生成。', { reason: 'stale-basis' });
    if (retryGenerationId) invalidateGeneration(oldGeneration, creation.lastResult);
    const job = requests.start('creation', { signal, onProgress });
    const startEpoch = workspace.version;
    // A new request must never leave an older draft looking like the failed result.
    const previousDraft = creation.draft?.definition;
    const dialogueBeforeGeneration = clone(creation.dialogue);
    const generation = retryGenerationId ? oldGeneration : { id: randomUUID(), description: description.trim(), conversationRevision: creation.dialogue.revision,
      voxelId: creation.voxelId, voxelRevision: voxel.state().revision, records: [], completedStages: [], adjustments: [], timings: { totalMs: 0, calls: [] } };
    generation.outcome = 'pending'; creation.generation = generation;
    creation.draft = null;
    const publish = job.publish;
    publish({ phase: 'connecting', elapsedMs: 0, eventsReceived: 0, outputCharacters: 0, preview: '' });
    let result = { ok: false, reason: 'request-failed', message: '创建世界没有完成，没有自动重试。' };
    try {
      persist(); const invoke = models.connect();
      const records = clone(generation.records), adjustments = [...generation.adjustments];
      let definition = null, failed = false;
      for (const stage of GENESIS_STAGES) {
        if (job.signal.aborted) { result = { ok: false, reason: 'cancelled', message: '创建世界已取消，现有世界保持原样。' }; failed = true; break; }
        if (generation.completedStages.includes(stage.id)) continue;
        const callIndex = generation.timings.calls.length + 1;
        const stageProgress = p => publish({ ...p, stageLabel: stage.label, stageIndex: generation.completedStages.length + 1,
          stageCount: GENESIS_STAGES.length, callCount: callIndex, elapsedMs: performance.now() - job.startedAt });
        stageProgress({ phase: 'connecting', outputCharacters: 0 });
        const sourceContext = retrieveSource(creation.source, [description, creation.dialogue.summary, stage.label]);
        const r = await invoke({ messages: buildGenesisMessages(description.trim(), {
          dialogue: conversational ? creation.dialogue : null, source: creation.source, sourceContext, previousDraft,
          diagnostics: creation.lastResult?.diagnostics ?? [], stage, previousRecords: records, voxel: voxel.state(),
        }), jsonMode: false, signal: job.signal, onProgress: stageProgress, role: 'world-genesis', metadata: { stage: stage.id, generationId: generation.id } });
        const audit = r.audit;
        generation.timings.calls.push({ stage: stage.id, model: audit.model, elapsedMs: audit.elapsedMs, headersReceivedMs: audit.headersReceivedMs, firstTextMs: audit.firstTextMs, reason: audit.error?.code ?? null });
        if (job.signal.aborted) result = { ok: false, reason: 'cancelled', message: '创建世界已取消，现有世界保持原样。' };
        else if (!r.ok) result = { ok: false, reason: r.audit.error?.code ?? 'request-failed', message: `${stage.label.replace('正在', '')}未完成，请继续讨论或重新生成。` };
        else if (workspace.version !== startEpoch) result = { ok: false, reason: 'stale-basis', message: '创建基准已变化，旧草稿未保留。' };
        else {
          let parsed;
          try {
            parsed = parseGenesisOutput(r.content, { partial: true });
          } catch (error) {
            result = { ok: false, reason: 'invalid-json', message: error.message,
              diagnostics: [{ path: stage.id, code: 'parse', message: error.message }] };
            failed = true; break;
          }
          try {
            adjustments.push(...parsed.adjustments);
            // Older model responses and regression fixtures may supply a complete
            // definition. It still passes the same full validation below.
            if (parsed.value && !records.length) { definition = parsed.value; break; }
            records.push(...readGenesisStage(parsed.records, stage, records));
            generation.records = clone(records); generation.adjustments = [...adjustments]; generation.completedStages.push(stage.id);
            persist();
            continue;
          } catch (error) {
            result = { ok: false, reason: 'invalid-stage', message: error.message,
              diagnostics: [{ path: stage.id, code: 'stage-contract', message: error.message }] };
          }
        }
        failed = true; break; // One attempt per step; never retry silently.
      }
      if (!failed) {
        publish({ ...job.progress, phase: 'verifying' });
        if (job.signal.aborted) result = { ok: false, reason: 'cancelled', message: '创建世界已取消，现有世界保持原样。' };
        else {
          if (!definition) {
            try { definition = compileGenesisRecords(records); }
            catch (error) { result = { ok: false, reason: 'invalid-world', message: error.message, diagnostics: [{ path: 'world', message: error.message }] }; }
          }
          const checked = definition ? checkWorldCandidate(definition) : null;
          if (checked && !checked.ok) result = { ...checked, message: '生成结果未通过世界规则或三维场景检查，请调整想法后再试。' };
          else if (checked) {
            const voxelSnapshot = voxel.state();
            creation.draft = { id: randomUUID(), description: description.trim(), definition: checked.definition,
              baseVoxelId: creation.voxelId, baseVoxelRevision: voxelSnapshot.revision,
              ...(conversational ? { baseConversationRevision: creation.dialogue.revision } : {}),
              voxelBindings: bindVoxelWorld({ definition: checked.definition, voxel: voxelSnapshot }),
              adjustments: [...adjustments, ...checked.adjustments], privacyAudit: checked.privacyAudit, createdAt: new Date().toISOString() };
            result = { ok: true, message: '这一片起点已生成。看看画面和规律，可以继续告诉我哪里要改，满意后再进入。' };
            if (conversational) creation.dialogue.messages.push({ id: randomUUID(), role: 'assistant', text: result.message });
          }
        }
      }
    } catch { result = { ok: false, reason: 'configuration-or-save-error', message: '创建世界的请求或保存未完成，请检查配置与本地存储；没有自动重试。' }; }
    finally {
      generation.outcome = result.ok ? 'ready' : result.reason === 'cancelled' ? 'cancelled' : 'failed';
      invalidateGeneration(generation, result);
      generation.timings.totalMs += performance.now() - job.startedAt;
      result.generationId = generation.id;
      job.finalize(); requests.setResult(result); creation.lastResult = result;
      try { persist(); }
      catch {
        creation.draft = null; creation.dialogue = dialogueBeforeGeneration; generation.outcome = 'failed';
        result = { ok: false, reason: 'save-error', generationId: generation.id, message: '起点草稿未能保存，不能确认进入。请恢复本地存储后重试。' };
        requests.setResult(result); creation.lastResult = result;
        try { persist(); } catch { /* Keep the last durable origin intact. */ }
      }
      job.finish();
    }
    return { ...result, state: state() };
  };
}
