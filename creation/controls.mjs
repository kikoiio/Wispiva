import { randomUUID } from 'node:crypto';
import { emptyDialogue } from './creation-dialogue.mjs';
import { MAX_SOURCE_CHARACTERS } from './creation-limits.mjs';
import { buildVoxelRepairCommands, inspectVoxelSpaces } from '../spatial/voxel-inspection.js';

export function createCreationControls({ workspace, world, blocked, response }) {
  const wrap = result => response(result.ok, result.message, result);
  return body => {
    const creation = workspace.creation;
    switch (body?.type) {
      case 'creation-open': case 'reset': {
        if (blocked()) return response(false, '请先完成或取消当前模型调用。');
        const reset = creation.mode === 'world' || body.type === 'reset';
        world.control({ type: 'pause' });
        workspace.change(next => {
          if (reset) Object.assign(next, { dialogue: emptyDialogue(), attempts: [], generation: null, draft: null, source: null, voxelId: randomUUID() });
          next.mode = 'create'; next.lastResult = null;
        }, { resetVoxel: reset });
        return response(true, '从一个新想法开始，现有世界已暂停并保留。');
      }
      case 'creation-resume':
        if (blocked() || !world.hasWorld) return response(false, '当前没有可返回的世界，或调用尚未结束。');
        workspace.change(next => { next.mode = 'world'; }); return response(true, '已返回现有世界。');
      case 'source-set': {
        if (blocked() || creation.mode !== 'create') return response(false, '请先结束当前请求，再更换素材。');
        const source = body.source;
        if (source !== null && (!source || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 120 || typeof source.text !== 'string' || !source.text.trim() || source.text.length > MAX_SOURCE_CHARACTERS)) return response(false, '请选择不超过 500 万字的非空文本文件；大文本会按需检索，不会整篇发送给模型。');
        workspace.change(next => {
          next.source = source ? { name: source.name.trim(), text: source.text } : null;
          next.dialogue.revision++; next.dialogue.ready = false; next.dialogue.summary = ''; next.draft = null; next.generation = null;
        });
        return response(true, source ? '素材已保存，现有建造保留。告诉我想从哪里开始。' : '素材已移除，现有建造保留。');
      }
      case 'voxel-undo': case 'voxel-redo':
        if (blocked() || creation.mode !== 'create') return response(false, '请先结束当前请求，再修改建造草稿。');
        try {
          workspace.voxel[body.type === 'voxel-undo' ? 'undo' : 'redo']({ baseRevision: body.baseRevision });
          return response(true, body.type === 'voxel-undo' ? '已撤销上一次建造。' : '已恢复上一次建造。');
        } catch (error) { return response(false, error.message || '修改未完成。'); }
      case 'voxel-repair': {
        if (blocked() || creation.mode !== 'create') return response(false, '请先结束当前请求，再修改建造草稿。');
        const current = workspace.voxel.state();
        if (body.baseRevision !== current.revision) return response(false, '场景已经更新，请重新检查当前问题。', { reason: 'stale-basis' });
        const issue = inspectVoxelSpaces(current).issues.find(entry => entry.objectId === body.objectId && entry.code === body.code);
        const commands = buildVoxelRepairCommands(current, issue);
        if (!commands) return response(false, '这项问题暂时没有安全的直接修复，请让助手根据当前场景处理。', { reason: 'repair-unavailable' });
        try {
          const prepared = workspace.voxel.prepare({ baseRevision: current.revision, commands });
          if (prepared.state.revision === current.revision) return response(false, '这项修复没有产生变化，请重新检查当前场景。', { reason: 'unchanged' });
          prepared.commit();
          return response(true, '已直接修复这一项空间问题；其他部件保持不变。', { reason: 'repaired', repair: { objectId: body.objectId, code: body.code } });
        } catch (error) { return response(false, error.message || '直接修复未完成，场景没有变化。', { reason: 'invalid-repair' }); }
      }
      case 'world-discard':
        if (blocked() || !creation.draft || creation.draft.id !== body.draftId) return response(false, '这个世界草稿已经变化。');
        workspace.change(next => { next.draft = null; }); return response(true, '草稿已放弃。');
      case 'world-accept':
        if (blocked()) return response(false, '这个世界草稿已经变化，不能创建。');
        return wrap(world.accept(body.draftId));
      case 'world-open':
        if (blocked()) return response(false, '找不到这个已保存的世界。');
        return wrap(world.open(body.worldId));
      default:
        if (creation.mode !== 'world' || !world.hasWorld) return response(false, '先创建或打开一个世界。');
        return wrap(world.control(body));
    }
  };
}
