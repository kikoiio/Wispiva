import { randomUUID } from 'node:crypto';
import { emptyDialogue, validDialogue } from './creation-dialogue.mjs';
import { checkWorldCandidate } from './world-genesis.mjs';
import { GENESIS_STAGES } from './genesis-records.mjs';
import { MAX_SOURCE_CHARACTERS } from './creation-limits.mjs';

export function restoreCreation(saved) {
  const creation = { mode: 'create', draft: null, lastResult: null, worlds: [], dialogue: emptyDialogue(), source: null, attempts: [], generation: null };
  if (saved?.schemaVersion === 1) {
    creation.mode = saved.mode === 'world' ? 'world' : 'create';
    if (saved.draft?.id && checkWorldCandidate(saved.draft.definition).ok) creation.draft = saved.draft;
    if (Array.isArray(saved.worlds)) creation.worlds = saved.worlds.filter(w => /^[0-9a-f-]{36}$/.test(w?.id) && typeof w.title === 'string' && Number.isSafeInteger(w.worldMinute));
    creation.lastResult = saved.pending ? { ok: false, message: '上次创建世界的请求中断，没有自动重试。' } : saved.lastResult ?? null;
    if (validDialogue(saved.dialogue)) creation.dialogue = saved.dialogue;
    if (Array.isArray(saved.attempts)) creation.attempts = saved.attempts.filter(a => typeof a?.id === 'string' && typeof a.userMessageId === 'string' && typeof a.outcome === 'string').slice(-80);
    if (saved.generation?.id && Array.isArray(saved.generation.records) && Array.isArray(saved.generation.completedStages) && Array.isArray(saved.generation.timings?.calls)) creation.generation = saved.generation;
    if (typeof saved.source?.name === 'string' && saved.source.name.length <= 120 && typeof saved.source?.text === 'string' && saved.source.text.length <= MAX_SOURCE_CHARACTERS && saved.source.text.trim()) creation.source = saved.source;
    if (saved.pending && saved.pendingKind !== 'creation') creation.dialogue.ready = false;
  }
  creation.voxelId = /^[0-9a-f-]{36}$/.test(saved?.voxelId || '') ? saved.voxelId : randomUUID();
  return creation;
}

export function recoverInterruptedCreation(creation) {
  for (const attempt of creation.attempts) if (attempt.outcome === 'pending') {
    const committedIterations = attempt.mode === 'loop'
      ? (attempt.loop?.iterations ?? []).filter(iteration => iteration.outcome === 'committed' && iteration.toRevision > iteration.fromRevision)
      : [];
    const lastCommitted = committedIterations.at(-1);
    const diagnostics = lastCommitted?.diagnostics ?? attempt.diagnostics ?? [];
    const message = lastCommitted
      ? `上次自动建造中断；此前已保存 ${committedIterations.length} 轮修改${diagnostics.length ? `，当前仍有 ${diagnostics.length} 项空间问题` : ''}。已保存场景保持可用，可以从当前内容继续。`
      : '上次请求中断，输入已保留。可以重试这次请求，或调整后发送。';
    Object.assign(attempt, { outcome: lastCommitted ? 'partial' : 'failed', reason: 'interrupted', message,
      ...(lastCommitted ? { toRevision: lastCommitted.toRevision, diagnostics } : {}), finishedAt: new Date().toISOString() });
    creation.dialogue.messages.push({ id: randomUUID(), role: 'assistant', text: attempt.message, attemptId: attempt.id });
    creation.lastResult = { ok: false, reason: attempt.reason, message: attempt.message, attemptId: attempt.id, ...(lastCommitted ? { diagnostics } : {}) };
  }
  if (creation.generation?.outcome === 'pending') {
    creation.generation.outcome = 'failed';
    creation.lastResult = { ok: false, reason: 'interrupted', message: '上次起点生成中断，已完成的步骤已保存。可点击继续生成，没有自动重试。', generationId: creation.generation.id };
  }
}

export function invalidateGeneration(generation, result) {
  if (!['invalid-world', 'invalid-world-scene', 'privacy-audit-failed', 'world-compile-failed'].includes(result?.reason) || !generation.completedStages.length) return;
  const stageFor = path => /^(world\.(actors|story\.(clues|facts))|initialMemories)(\.|\[|$)/.test(path) ? 1
    : /^world\.(resources|processes|actions)(\.|\[|$)/.test(path) ? 2 : 0;
  const firstInvalid = result.diagnostics?.length ? Math.min(...result.diagnostics.map(d => stageFor(d.path || ''))) : 0;
  const retained = GENESIS_STAGES.slice(0, firstInvalid), types = new Set(retained.flatMap(s => s.types));
  generation.completedStages = generation.completedStages.filter(id => retained.some(s => s.id === id));
  generation.records = generation.records.filter(r => types.has(r.type));
  generation.adjustments = [];
}
