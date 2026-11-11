import { exists } from '../storage/files.mjs';
import { createVoxelWorldStore } from '../voxel/voxel-world.mjs';
import { restoreCreation, recoverInterruptedCreation, invalidateGeneration } from './recovery.mjs';

export function createCreationWorkspace({ repository, requestCheckpoint }) {
  const saved = repository.readCreation();
  let creation = restoreCreation(saved), version = 0, activeEdit = null;
  const current = () => activeEdit?.creation ?? creation;
  const write = (value, store, snapshot = store.snapshot?.()) => repository.saveCreation({ schemaVersion: 1, ...value,
    voxelRevision: snapshot?.revision ?? store.state().revision,
    ...(snapshot ? { voxelSnapshot: snapshot } : saved?.voxelSnapshot ? { voxelSnapshot: saved.voxelSnapshot } : {}),
    ...requestCheckpoint(),
  });
  function openVoxel(id, expected = 0, snapshot) {
    const file = repository.voxelFile(id);
    try {
      if (snapshot !== undefined && snapshot?.revision !== expected) throw Error('体素草稿版本不一致');
      if (snapshot === undefined && expected > 0 && !exists(file)) throw Error('已保存的体素草稿文件缺失');
      return createVoxelWorldStore({ file, snapshot, onSave: next => write(current(), voxel, next) });
    } catch {
      const message = '建造草稿文件缺失或损坏；原文件已保留，请恢复后重启。';
      creation.lastResult = { ok: false, reason: 'voxel-recovery', message };
      const fail = () => { throw Error(message); };
      return { state: () => ({ revision: expected, cells: [], objects: [], canUndo: false, canRedo: false, error: message }), apply: fail, undo: fail, redo: fail };
    }
  }
  let voxel = openVoxel(creation.voxelId, Number.isSafeInteger(saved?.voxelRevision) ? saved.voxelRevision : 0, saved?.voxelSnapshot);
  recoverInterruptedCreation(creation);
  if (repository.retireLegacy()) creation.mode = 'create';
  creation.worlds = creation.worlds.filter(world => repository.isGeneratedArchive(world.id));
  if (creation.generation?.outcome === 'failed') invalidateGeneration(creation.generation, creation.lastResult);
  return {
    get creation() { return structuredClone(current()); },
    get mode() { return current().mode; },
    get voxel() { return voxel; },
    get version() { return version; },
    save() { write(current(), voxel); },
    // A flow edits its own draft. Only this session can publish it, and voxel
    // commits save that draft and their candidate snapshot in the same file.
    beginFlow() {
      if (activeEdit) throw new Error('A creation flow is already active');
      const edit = { creation: structuredClone(creation), voxel, version };
      activeEdit = edit;
      const isCurrent = () => activeEdit === edit && version === edit.version && voxel === edit.voxel;
      const assertCurrent = () => {
        if (!isCurrent()) throw new Error('Creation flow is no longer current');
      };
      return {
        creation: edit.creation, version: edit.version, isCurrent,
        voxel: {
          state() { assertCurrent(); return edit.voxel.state(); },
          prepare(body) {
            assertCurrent();
            const candidate = edit.voxel.prepare(body);
            return { ...candidate, commit() { assertCurrent(); return candidate.commit(); } };
          },
        },
        save() { assertCurrent(); write(edit.creation, edit.voxel); },
        finish() {
          assertCurrent();
          // Failed outcomes remain visible even if storage is unavailable.
          creation = structuredClone(edit.creation); activeEdit = null;
        },
      };
    },
    restoreWorld({ hasWorld, draftId }) {
      if (activeEdit) throw new Error('Cannot restore a world during creation');
      if (hasWorld && creation.draft?.id === draftId) { creation.draft = null; creation.mode = 'world'; }
      if (!hasWorld) creation.mode = 'create';
    },
    // Control commands publish a replacement only after its save succeeds.
    change(update, { resetVoxel = false } = {}) {
      if (activeEdit) throw new Error('Cannot replace creation during an active flow');
      const next = structuredClone(creation);
      update(next);
      const nextVoxel = resetVoxel ? openVoxel(next.voxelId) : voxel;
      write(next, nextVoxel);
      creation = structuredClone(next); voxel = nextVoxel; version++;
    },
    // The active world has already committed in its own file. Reflect that
    // fact even when saving secondary creation metadata fails.
    reconcileWorld(update) {
      if (activeEdit) throw new Error('Cannot switch worlds during an active flow');
      const next = structuredClone(creation);
      update(next);
      creation = structuredClone(next); version++;
      write(creation, voxel);
    },
    view() {
      const value = current();
      return { ...structuredClone({ ...value, source: value.source ? { name: value.source.name, characters: value.source.text.length } : null }), voxel: voxel.state() };
    },
  };
}
