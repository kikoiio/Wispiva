import { randomUUID } from 'node:crypto';
import { parseGeneratedJSON } from '../../model/generated-json.mjs';
import { retrieveSource } from '../../model/source-retrieval.mjs';
import { normalizeBuildingCommands, describeChanges, recoverableAttempt } from '../../voxel/creation-attempt.mjs';
import { buildVoxelRepairCommands, inspectVoxelSpaces } from '../../spatial/voxel-inspection.js';
import { checkDiscussion, normalizeDiscussion, buildDiscussionMessages } from '../creation-dialogue.mjs';
import { MAX_BUILD_LOOP_ITERATIONS } from '../creation-limits.mjs';
const clone = value => structuredClone(value);

function explanationText(reply) {
  const text = reply.trim();
  return /commands\s*[:：]|```|["']op["']\s*:/.test(text)
    ? text.split(/\n\s*(?:commands\s*[:：]|```|\[?\s*\{)/i)[0].trim() || '模型提供了建造方案，实际执行结果见下方。'
    : text;
}

export function createDiscussionFlow({ workspace, requests, models, blocked, response, state }) {
  return async ({ message, mode = 'auto', retryAttemptId, baseVoxelRevision, voxelId: clientVoxelId, conversationRevision, maxIterations } = {}, { onProgress, signal } = {}) => {
    let creation = workspace.creation;
    let voxel = workspace.voxel;
    if (blocked() || creation.mode !== 'create') return response(false, '先结束当前请求，再继续讨论。', { reason: 'busy' });
    if (voxel.state().error) return response(false, voxel.state().error, { reason: 'voxel-recovery' });
    if (baseVoxelRevision !== undefined && baseVoxelRevision !== voxel.state().revision || clientVoxelId !== undefined && clientVoxelId !== creation.voxelId || conversationRevision !== undefined && conversationRevision !== creation.dialogue.revision) return response(false, '场景或讨论已经更新，请检查当前画面后再发送。', { reason: 'stale-basis' });
    let previous = retryAttemptId && creation.attempts.find(a => a.id === retryAttemptId);
    if (retryAttemptId) {
      if (!recoverableAttempt(previous) || previous !== creation.attempts.at(-1)) return response(false, '这次意图已有后续处理，请按当前想法发送新消息。', { reason: 'stale-attempt' });
      message = creation.dialogue.messages.find(m => m.id === previous.userMessageId)?.text;
      mode = previous.mode;
    }
    if (!['auto', 'discuss', 'build', 'loop'].includes(mode)) return response(false, '请选择讨论、建造或自动建造。', { reason: 'invalid-mode' });
    if (typeof message !== 'string' || !message.trim() || message.length > 8000) return response(false, '写下你的想法或想调整的细节。', { reason: 'invalid-message' });
    if (creation.dialogue.messages.length >= 78 || creation.dialogue.messages.reduce((n, m) => n + m.text.length, 0) + message.length > 40000) return response(false, '这段讨论已经很长，请先生成并确认这一小片起点。', { reason: 'conversation-limit' });
    const job = requests.start('discussion', { signal, onProgress, context: { callCount: 1 } });
    const edit = workspace.beginFlow();
    creation = edit.creation; voxel = edit.voxel;
    previous = retryAttemptId && creation.attempts.find(a => a.id === retryAttemptId);
    const persist = () => edit.save();
    const startedAt = job.startedAt;
    const user = retryAttemptId ? creation.dialogue.messages.find(m => m.id === previous.userMessageId) : { id: randomUUID(), role: 'user', text: message.trim() };
    if (!retryAttemptId) creation.dialogue.messages.push(user);
    creation.dialogue.revision++; creation.dialogue.ready = false;
    const voxelBasis = voxel.state(), voxelId = creation.voxelId;
    const loopRequested = mode === 'loop';
    const loopMax = loopRequested && Number.isSafeInteger(maxIterations) ? Math.max(1, Math.min(MAX_BUILD_LOOP_ITERATIONS, maxIterations)) : MAX_BUILD_LOOP_ITERATIONS;
    const attempt = { id: randomUUID(), userMessageId: user.id, mode, retryOf: previous?.id ?? null, outcome: 'pending',
      voxelId, fromRevision: voxelBasis.revision, toRevision: voxelBasis.revision, message: '请求已保存，尚未修改场景。',
      createdAt: new Date().toISOString(), diagnostics: [], adjustments: [],
      ...(loopRequested ? { loop: { maxIterations: loopMax, iterations: [] } } : {}),
      timings: { totalMs: 0, modelMs: 0, validationMs: 0, commitMs: 0, calls: [] } };
    creation.attempts.push(attempt); creation.attempts = creation.attempts.slice(-80);
    job.updateContext({ loopIteration: null, loopMax: loopRequested ? loopMax : null });
    const publish = job.publish;
    const fail = (reason, message, diagnostics = []) => ({ ok: false, reason, message, diagnostics });
    let result = fail('request-failed', '请求没有完成，输入已保留。可以重试这次请求，或调整后发送。');
    let explanation = '', value, prepared, commitStarted, durable = false;
    const dialogueBeforeReply = clone(creation.dialogue);
    const request = async (invoke, currentVoxel, sourceContext, retrievalRound = false, loopContext = null) => {
      job.updateContext({ callCount: attempt.timings.calls.length + 1 });
      const r = await invoke({ messages: buildDiscussionMessages(creation.dialogue, creation.draft, creation.source, currentVoxel,
        { sourceContext, retrievalRound, mode, previousAttempt: previous, attempts: creation.attempts.filter(a => a.id !== attempt.id), loopContext }), signal: job.signal, onProgress: publish, role: retrievalRound ? 'world-discussion-retrieval' : 'world-discussion', metadata: { attemptId: attempt.id } });
      const audit = r.audit;
      attempt.timings.calls.push({ model: audit.model, elapsedMs: audit.elapsedMs, headersReceivedMs: audit.headersReceivedMs,
        firstEventMs: audit.firstEventMs, firstTextMs: audit.firstTextMs, requestSent: audit.requestSent, reasoningEffort: audit.reasoningEffort, reason: audit.error?.code ?? null });
      attempt.timings.modelMs += audit.elapsedMs;
      return r;
    };
    const basisCurrent = () => edit.isCurrent() && !voxel.state().error;
    const originalBasisCurrent = () => basisCurrent() && voxel.state().revision === voxelBasis.revision;
    publish({ phase: 'connecting', eventsReceived: 0, outputCharacters: 0, preview: '' });
    let committedDuringLoop = false, loopSummary = creation.dialogue.summary;
    const loopChanges = { cells: 0, objects: 0, added: 0, removed: 0, replaced: 0 };
    const inspectionDiagnostics = inspection => inspection.issues.map(i => ({ path: `objects.${i.objectId}.${i.code}`, message: i.message }));
    const mergeChanges = changes => { for (const key of Object.keys(loopChanges)) loopChanges[key] += changes[key] || 0; };
    let parseFailure = null;
    const parse = content => { parseFailure = null; try {
      const parsed = parseGeneratedJSON(content, { allowEmbeddedObject: true, requiredKeys: mode === 'loop' ? ['commands'] : ['reply'] });
      attempt.adjustments.push(...parsed.adjustments.map(message => ({ path: 'response', message })));
      const normalized = normalizeDiscussion(parsed.value, loopSummary || creation.dialogue.summary);
      if (mode === 'loop' && normalized && Array.isArray(parsed.value.commands)) {
        if (!normalized.reply) normalized.reply = '本轮依据当前场景和空间检查结果提出了局部修改，程序会报告实际提交和复查结果。';
        if (!normalized.summary) normalized.summary = loopSummary || creation.dialogue.summary || '按检查结果逐项完善当前场景。';
      }
      return normalized;
    } catch (error) { parseFailure = error instanceof Error ? error.message : '模型回复无法安全解析。'; return null; } };
    const commitCandidate = (candidate, iteration = null) => {
      publish({ ...job.progress, phase: 'committing', ...(iteration ? { loopIteration: iteration } : {}) });
      const commitStartedAt = performance.now();
      if (job.signal.aborted || !basisCurrent()) throw Object.assign(new Error('commit interrupted'), { reason: job.signal.aborted ? 'cancelled' : 'stale-basis' });
      candidate.commit();
      attempt.timings.commitMs += performance.now() - commitStartedAt;
      committedDuringLoop = true;
    };
    try {
      persist();
      const invoke = models.connect();
      if (loopRequested) {
        for (let iteration = 1; iteration <= loopMax; iteration++) {
          job.updateContext({ loopIteration: iteration });
          const currentVoxel = voxel.state();
          const exactRepair = currentVoxel.cells.length <= 5000
            ? inspectVoxelSpaces(currentVoxel).issues.find(issue => buildVoxelRepairCommands(currentVoxel, issue))
            : null;
          if (exactRepair) {
            if (job.signal.aborted) { result = fail('cancelled', '自动建造已取消，已提交的前面几轮保持不变。'); break; }
            if (!basisCurrent()) { result = fail('stale-basis', '场景或讨论已经变化，这次自动建造停止。'); break; }
            const validationStarted = performance.now();
            try {
              const commands = buildVoxelRepairCommands(currentVoxel, exactRepair);
              prepared = voxel.prepare({ baseRevision: currentVoxel.revision, commands });
              const changes = describeChanges(prepared.changes);
              const diagnostics = inspectionDiagnostics(inspectVoxelSpaces(prepared.state));
              const iterationRecord = { index: iteration, fromRevision: currentVoxel.revision, toRevision: prepared.state.revision,
                outcome: prepared.state.revision === currentVoxel.revision ? 'unchanged' : 'committed', changes, diagnostics,
                repair: { method: 'deterministic', objectId: exactRepair.objectId, code: exactRepair.code } };
              attempt.loop.iterations.push(iterationRecord);
              attempt.timings.validationMs += performance.now() - validationStarted;
              if (prepared.state.revision === currentVoxel.revision) {
                result = fail('loop-no-progress', `自动建造第 ${iteration} 轮的确定性修复没有产生变化。`, diagnostics);
                prepared = null;
                break;
              }
              commitCandidate(prepared, iteration); prepared = null;
              mergeChanges(changes); attempt.changes = { ...loopChanges }; attempt.toRevision = voxel.state().revision;
              attempt.outcome = 'committed';
              if (!diagnostics.length) {
                result = { ok: true, message: `自动建造完成，共检查 ${iteration} 轮。程序按空间检查结果自动修复了一个可精确定位的问题。`, diagnostics: [] };
                break;
              }
              if (iteration === loopMax) {
                result = { ok: false, reason: 'loop-limit', message: `自动建造已提交 ${iteration} 轮，但还剩 ${diagnostics.length} 项空间检查问题。`, diagnostics };
                break;
              }
              continue;
            } catch (error) {
              prepared = null;
              const diagnostics = error.diagnostics ?? [{ path: `loop.${iteration}.repair`, message: error.message }];
              const prior = attempt.loop.iterations.at(-1);
              if (prior?.index === iteration && prior.repair?.method === 'deterministic') {
                Object.assign(prior, { toRevision: currentVoxel.revision, outcome: 'failed',
                  changes: { cells: 0, objects: 0, added: 0, removed: 0, replaced: 0 }, diagnostics });
              } else {
                attempt.loop.iterations.push({ index: iteration, fromRevision: currentVoxel.revision, toRevision: currentVoxel.revision,
                  outcome: 'failed', changes: { cells: 0, objects: 0, added: 0, removed: 0, replaced: 0 }, diagnostics,
                  repair: { method: 'deterministic', objectId: exactRepair.objectId, code: exactRepair.code } });
                attempt.timings.validationMs += performance.now() - validationStarted;
              }
              result = error.reason === 'cancelled' ? fail('cancelled', '自动建造已取消，已提交的前面几轮保持不变。')
                : error.reason === 'stale-basis' ? fail('stale-basis', '场景或讨论已经变化，这次自动建造停止。')
                : fail('invalid-repair', `自动建造第 ${iteration} 轮的确定性修复未通过检查。`, diagnostics);
              break;
            }
          }
          const loopContext = { iteration, maxIterations: loopMax, revision: currentVoxel.revision,
            previousDiagnostics: iteration === 1 ? [] : attempt.loop.iterations.at(-1)?.diagnostics ?? [],
            previousSummary: loopSummary || creation.dialogue.summary };
          publish({ phase: 'connecting', eventsReceived: 0, outputCharacters: 0, preview: '' });
          let r = await request(invoke, currentVoxel, retrieveSource(creation.source, [message, loopSummary, ...loopContext.previousDiagnostics.map(d => d.message)]), false, loopContext);
          if (r.ok) value = parse(r.content);
          if (!job.signal.aborted && basisCurrent() && checkDiscussion(value) && value.retrievalQueries?.length && creation.source) {
            r = await request(invoke, currentVoxel, retrieveSource(creation.source, value.retrievalQueries), true, loopContext);
            value = r.ok ? parse(r.content) : null;
          }
          const validationStarted = performance.now();
          publish({ ...job.progress, phase: 'verifying', loopIteration: iteration });
          if (job.signal.aborted) { result = fail('cancelled', '自动建造已取消，已提交的前面几轮保持不变。'); break; }
          if (!basisCurrent()) { result = fail('stale-basis', '场景或讨论已经变化，这次自动建造停止。'); break; }
          if (!r.ok) { result = fail(r.audit.error?.code ?? 'request-failed', '自动建造的这一轮模型请求未完成。'); break; }
          if (!checkDiscussion(value)) {
            const diagnostics = [{ path: 'discussion', message: parseFailure || '需要非空 reply、summary 和布尔 ready；commands 若提供必须是数组。' }];
            attempt.loop.iterations.push({ index: iteration, fromRevision: currentVoxel.revision, toRevision: currentVoxel.revision,
              outcome: 'failed', changes: { cells: 0, objects: 0, added: 0, removed: 0, replaced: 0 }, diagnostics });
            attempt.timings.validationMs += performance.now() - validationStarted;
            result = fail('invalid-discussion', '自动建造收到的模型回复格式不完整。', diagnostics);
            if (iteration < loopMax) continue;
            break;
          }
          explanation = explanationText(value.reply);
          loopSummary = value.summary.trim();
          if (!value.commands?.length) {
            const inspection = inspectVoxelSpaces(currentVoxel);
            const diagnostics = inspectionDiagnostics(inspection);
            const sceneIsEmpty = currentVoxel.cells.length === 0;
            attempt.loop.iterations.push({ index: iteration, fromRevision: currentVoxel.revision, toRevision: currentVoxel.revision,
              outcome: diagnostics.length || sceneIsEmpty ? 'stalled' : 'complete', changes: { cells: 0, objects: 0, added: 0, removed: 0, replaced: 0 }, diagnostics });
            if (!diagnostics.length && !sceneIsEmpty) {
              result = { ok: true, message: committedDuringLoop ? `自动建造完成，共检查 ${iteration} 轮。` : '当前场景已经满足这次自动建造要求，没有需要提交的变化。', diagnostics: [] };
              attempt.outcome = committedDuringLoop ? 'committed' : 'unchanged';
            } else {
              if (sceneIsEmpty && !committedDuringLoop) attempt.outcome = 'not-built';
              result = fail('no-building-commands', sceneIsEmpty
                ? '自动建造尚未创建任何方块；模型没有给出建造命令。'
                : `自动建造第 ${iteration} 轮没有给出修复命令，仍有 ${diagnostics.length} 项检查问题。`, diagnostics);
            }
            attempt.timings.validationMs += performance.now() - validationStarted;
            break;
          }
          if (currentVoxel.cells.length > 5000) { result = fail('scene-too-large', '当前场景超过自动建造的单轮编辑范围，请先缩小场景。'); break; }
          try {
            const normalized = normalizeBuildingCommands(value.commands);
            attempt.adjustments.push(...normalized.adjustments);
            prepared = voxel.prepare({ baseRevision: currentVoxel.revision, commands: normalized.commands });
            const changes = describeChanges(prepared.changes);
            const inspection = inspectVoxelSpaces(prepared.state);
            const diagnostics = inspectionDiagnostics(inspection);
            const iterationRecord = { index: iteration, fromRevision: currentVoxel.revision, toRevision: prepared.state.revision,
              outcome: prepared.state.revision === currentVoxel.revision ? 'unchanged' : 'committed', changes, diagnostics };
            attempt.loop.iterations.push(iterationRecord);
            attempt.timings.validationMs += performance.now() - validationStarted;
            if (prepared.state.revision === currentVoxel.revision) {
              result = fail('loop-no-progress', `自动建造第 ${iteration} 轮没有产生变化。`, diagnostics);
              prepared = null;
              break;
            }
            commitCandidate(prepared, iteration); prepared = null;
            mergeChanges(changes); attempt.changes = { ...loopChanges }; attempt.toRevision = voxel.state().revision;
            attempt.outcome = 'committed';
            if (!diagnostics.length) {
              result = { ok: true, message: `自动建造完成，共提交 ${iteration} 轮。新增 ${loopChanges.added}、替换 ${loopChanges.replaced}、移除 ${loopChanges.removed} 个方块；更新 ${loopChanges.objects} 个对象。`, diagnostics: [] };
              break;
            }
            if (iteration === loopMax) {
              result = { ok: false, reason: 'loop-limit', message: `自动建造已提交 ${iteration} 轮，但还剩 ${diagnostics.length} 项空间检查问题。`, diagnostics };
              break;
            }
          } catch (error) {
            prepared = null;
            const diagnostics = error.diagnostics ?? [{ path: `loop.${iteration}`, message: error.message }];
            const prior = attempt.loop.iterations.at(-1);
            if (prior?.index === iteration && prior.outcome !== 'failed') {
              Object.assign(prior, { toRevision: currentVoxel.revision, outcome: 'failed',
                changes: { cells: 0, objects: 0, added: 0, removed: 0, replaced: 0 }, diagnostics });
            } else {
              attempt.loop.iterations.push({ index: iteration, fromRevision: currentVoxel.revision, toRevision: currentVoxel.revision,
                outcome: 'failed', changes: { cells: 0, objects: 0, added: 0, removed: 0, replaced: 0 }, diagnostics });
              attempt.timings.validationMs += performance.now() - validationStarted;
            }
            result = error.reason === 'cancelled' ? fail('cancelled', '自动建造已取消，已提交的前面几轮保持不变。')
              : error.reason === 'stale-basis' ? fail('stale-basis', '场景或讨论已经变化，这次自动建造停止。')
              : fail('invalid-building', `自动建造第 ${iteration} 轮未通过检查。`, diagnostics);
            if (!error.reason && iteration < loopMax) continue;
            break;
          }
        }
        if (!result.ok && committedDuringLoop) {
          const currentDiagnostics = inspectionDiagnostics(inspectVoxelSpaces(voxel.state()));
          const diagnostics = result.diagnostics?.length ? result.diagnostics : currentDiagnostics;
          attempt.outcome = 'partial';
          result = { ...result, diagnostics, message: `自动建造已保存前面几轮的修改，但本轮没有完成：${result.message}` };
        }
      } else {
        let r = await request(invoke, voxelBasis, retrieveSource(creation.source, [message, creation.dialogue.summary]));
        if (r.ok) value = parse(r.content);
        if (!job.signal.aborted && originalBasisCurrent() && checkDiscussion(value) && value.retrievalQueries?.length && creation.source) {
          r = await request(invoke, voxelBasis, retrieveSource(creation.source, value.retrievalQueries), true);
          value = r.ok ? parse(r.content) : null;
        }
        const validationStarted = performance.now();
        publish({ ...job.progress, phase: 'verifying' });
        if (job.signal.aborted) result = fail('cancelled', '这次请求已取消，场景没有变化。输入已保留，可重试或调整。');
        else if (!originalBasisCurrent()) result = fail('stale-basis', '场景或讨论已经变化，这次结果未采用。重试会重新读取当前场景。');
        else if (!r.ok) result = fail(r.audit.error?.code ?? 'request-failed', '模型回复未完成，场景没有变化。输入已保留，可检查连接后重试。');
        else if (!checkDiscussion(value)) result = fail('invalid-discussion', '模型回复格式不完整，场景没有变化。可以按原意图重试，无需重新描述。', [{ path: 'discussion', message: '需要非空 reply、summary 和布尔 ready；commands 若提供必须是数组。' }]);
        else {
          explanation = explanationText(value.reply);
          if (mode !== 'discuss' && value.commands?.length) {
            if (voxelBasis.cells.length > 5000) result = fail('scene-too-large', '当前场景超过单次编辑范围，这次没有修改。请缩小场景后再试。');
            else {
              try {
                const normalized = normalizeBuildingCommands(value.commands);
                attempt.adjustments.push(...normalized.adjustments);
                prepared = voxel.prepare({ baseRevision: voxelBasis.revision, commands: normalized.commands });
                attempt.changes = describeChanges(prepared.changes);
                attempt.toRevision = prepared.state.revision;
                const inspection = inspectVoxelSpaces(prepared.state);
                result = { ok: true, message: prepared.state.revision === voxelBasis.revision ? '已检查建造步骤，场景没有变化。' :
                  `已保存本次建造：新增 ${attempt.changes.added}、替换 ${attempt.changes.replaced}、移除 ${attempt.changes.removed} 个方块；更新 ${attempt.changes.objects} 个对象。${inspection.issues.length ? ` 空间检查还有 ${inspection.issues.length} 项待处理，请查看画布下方。` : ''}`,
                  diagnostics: inspectionDiagnostics(inspection) };
                attempt.outcome = prepared.state.revision === voxelBasis.revision ? 'unchanged' : 'committed';
              } catch (error) { result = fail('invalid-building', error.diagnostics ? error.message : '建造步骤未通过检查，这次没有修改。可重试或缩小范围。', error.diagnostics ?? [{ path: 'commands', message: error.message }]); }
            }
          } else if (mode === 'build') {
            result = fail('no-building-commands', '这次只收到文字说明，没有可执行的建造步骤，场景没有变化。可以重试建造，或补充最想先看见的部分。');
            attempt.outcome = 'not-built';
          } else { result = { ok: true, message: '本轮仅讨论，场景未修改。' }; attempt.outcome = 'discussion'; }
        }
        attempt.timings.validationMs = performance.now() - validationStarted;
      }
    } catch (error) {
      result = fail(['EISDIR', 'ENOSPC', 'EDQUOT', 'EACCES', 'EROFS', 'ENOENT', 'EPERM'].includes(error.code) ? 'save-error' : 'configuration-or-save-error', '请求或保存未完成，场景没有变化。输入已保留，请检查模型连接与本地存储后重试。');
    }
    const recordResult = () => {
      if (!result.ok && !['not-built', 'cancelled', 'partial'].includes(attempt.outcome)) attempt.outcome = result.reason === 'cancelled' ? 'cancelled' : 'failed';
      Object.assign(attempt, { reason: result.reason ?? null, message: result.message, diagnostics: result.diagnostics ?? [], finishedAt: new Date().toISOString() });
      attempt.timings.totalMs = performance.now() - startedAt;
      creation.dialogue.messages.push({ id: randomUUID(), role: 'assistant', text: result.ok || attempt.outcome === 'not-built' ? explanation || result.message : result.message, attemptId: attempt.id });
      if ((result.ok || attempt.outcome === 'not-built') && value) {
        creation.dialogue.summary = value.summary.trim();
        creation.dialogue.ready = value.ready && ((mode === 'build' || mode === 'loop') && result.ok || creation.dialogue.messages.filter(m => m.role === 'user').length >= 2);
      }
      creation.lastResult = { ...result, attemptId: attempt.id }; requests.setResult(creation.lastResult);
    };
    try {
      recordResult(); job.finalize();
      if (result.ok && prepared && attempt.outcome === 'committed') {
        publish({ ...job.progress, phase: 'committing' }); commitStarted = performance.now();
        if (job.signal.aborted || !originalBasisCurrent()) throw Object.assign(new Error('commit interrupted'), { reason: job.signal.aborted ? 'cancelled' : 'stale-basis' });
        prepared.commit(); durable = true;
        attempt.timings.commitMs = performance.now() - commitStarted;
      } else { commitStarted = performance.now(); persist(); durable = true; if (!committedDuringLoop) attempt.timings.commitMs = performance.now() - commitStarted; }
      attempt.timings.totalMs = performance.now() - startedAt;
      // The first save is authoritative; a failed metrics update cannot uncommit it.
      try { persist(); } catch { /* Durable scene and outcome already agree. */ }
    } catch (error) {
      if (!durable && committedDuringLoop) {
        attempt.outcome = 'partial'; attempt.toRevision = voxel.state().revision;
        result = fail(error.reason ?? 'save-error', '自动建造的部分修改已经保存，但本次结果记录未能完整保存；可以从当前场景继续调整。');
        Object.assign(attempt, { reason: result.reason, message: result.message, diagnostics: result.diagnostics, finishedAt: new Date().toISOString() });
        creation.lastResult = { ...result, attemptId: attempt.id }; requests.setResult(creation.lastResult);
        try { persist(); } catch { /* Keep the durable voxel snapshot and recover the attempt on restart. */ }
      } else if (!durable) {
        creation.dialogue = dialogueBeforeReply;
        attempt.outcome = 'failed'; attempt.toRevision = voxelBasis.revision; delete attempt.changes;
        result = error.reason ? fail(error.reason, error.reason === 'cancelled' ? '这次请求已取消，场景没有变化。输入已保留，可重试或调整。' : '场景已经变化，这次结果未采用。') : fail('save-error', '这次保存没有完成，场景没有变化。输入已保留，请恢复本地存储后重试。');
        recordResult();
        try { persist(); } catch { /* Keep the intent visible in this session; the last durable attempt recovers on restart. */ }
      }
    } finally {
      edit.finish(); job.finish();
    }
    return { ...result, reply: explanation, attempt: clone(attempt), state: state() };
  };
}
