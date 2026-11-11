import { randomUUID } from 'node:crypto';
import { CampSimulation } from '../simulation/core.mjs';
import { bindVoxelWorld } from '../spatial/voxel-bindings.mjs';
import { checkWorldCandidate } from './world-genesis.mjs';

export function createWorldLifecycle({ stateFile, repository, workspace, openExperience }) {
  let current = repository.activeExists() ? openExperience() : null;
  workspace.restoreWorld({ hasWorld: Boolean(current), draftId: current?.state().genesis?.draftId });
  if (current && workspace.mode === 'create') current.control({ type: 'pause' });

  function archiveCurrent() {
    if (!current) return;
    current.close();
    const snapshot = CampSimulation.load(stateFile);
    const state = current.state(), id = randomUUID();
    repository.saveArchive(id, snapshot.snapshot());
    workspace.change(next => next.worlds.push({ id, title: state.world.title || state.scene?.document?.title || '之前的旅途', worldMinute: state.worldMinute }));
  }

  function replaceWorld(simulation, options) {
    try { archiveCurrent(); simulation.save(stateFile, options); }
    catch (error) { current = repository.activeExists() ? openExperience() : null; throw error; }
    current = openExperience();
  }

  return {
    get hasWorld() { return current !== null; },
    get pending() { return Boolean(current?.state().model.pending); },
    state: () => current?.state() ?? { world: null, worldMinute: 0, revision: 0, paused: true, speed: 24, waiting: null, actors: {}, autonomy: { enabled: false, waitingReason: null }, scene: null, model: { pending: false } },
    control: body => current?.control(body),
    cancelModel: () => current?.cancelModel(),
    actorStep: (body, options) => current.actorStep(body, options),
    sceneStep: (body, options) => current.sceneStep(body, options),
    close() { current?.close(); },
    accept(draftId) {
      const creation = workspace.creation, draft = creation.draft;
      if (!draft || draft.id !== draftId) return { ok: false, message: '这个世界草稿已经变化，不能创建。' };
      const voxel = workspace.voxel.state();
      if (voxel.error) return { ok: false, message: voxel.error };
      if (draft.baseConversationRevision !== undefined && draft.baseConversationRevision !== creation.dialogue.revision) return { ok: false, message: '讨论已经更新，请先按新的设定生成草稿，再确认进入。' };
      if (draft.baseVoxelId !== undefined && (draft.baseVoxelId !== creation.voxelId || draft.baseVoxelRevision !== voxel.revision)) return { ok: false, message: '建造草稿已经改变，请重新检查起点。' };
      const checked = checkWorldCandidate(draft.definition);
      if (!checked.ok) return { ...checked, message: '草稿未通过检查。' };
      const { definition } = checked;
      const simulation = new CampSimulation({ world: definition.world }); simulation.pause();
      const origin = simulation.view(1);
      const genesis = { draftId, description: draft.description, initialMemories: definition.initialMemories, instanceId: origin.instanceId, worldTitle: definition.world.title,
        scene: structuredClone(definition.scene), voxel, voxelBindings: structuredClone(draft.voxelBindings || bindVoxelWorld({ definition, voxel })),
        adjustments: structuredClone(draft.adjustments || []), dialogue: structuredClone(creation.dialogue) };
      const experience = { ledgers: Object.fromEntries(definition.world.actors.map(actor => [actor.id, { entries: [], lastDecision: null }])),
        autonomy: { enabled: false, waitingReason: null, nextActorId: definition.world.actors[0].id }, lastResult: null, recovery: null,
        pending: false, pendingKind: null, genesis, scene: { document: definition.scene, revision: 0, draft: null, lastResult: null } };
      replaceWorld(simulation, { experience });
      workspace.reconcileWorld(next => {
        next.draft = null; next.mode = 'world'; next.lastResult = { ok: true, message: '世界已创建，时间停在起源，随时可以开始。' };
      });
      return workspace.creation.lastResult;
    },
    open(worldId) {
      if (!workspace.creation.worlds.some(world => world.id === worldId)) return { ok: false, message: '找不到这个已保存的世界。' };
      if (!repository.isGeneratedArchive(worldId)) return { ok: false, message: '旧实验不属于已创建的世界，请重新生成。' };
      const selected = CampSimulation.load(repository.archiveFile(worldId)); selected.pause();
      replaceWorld(selected);
      workspace.reconcileWorld(next => { next.mode = 'world'; });
      return { ok: true, message: '已切换到保存的世界。' };
    },
  };
}
