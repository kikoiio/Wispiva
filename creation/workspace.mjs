import { exists } from '../storage/files.mjs';
import { createVoxelWorldStore } from '../voxel/voxel-world.mjs';
import { restoreCreation, recoverInterruptedCreation, invalidateGeneration } from './recovery.mjs';

export function createCreationWorkspace({ repository, requestCheckpoint }) {
  const saved = repository.readCreation();
  let creation = restoreCreation(saved), version = 0;
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
      return createVoxelWorldStore({ file, snapshot, onSave: next => write(creation, voxel, next) });
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
    get creation() { return creation; },
    get voxel() { return voxel; },
    get version() { return version; },
    save() { write(creation, voxel); },
    // Control commands publish a replacement only after its save succeeds.
    change(update, { resetVoxel = false } = {}) {
      const next = structuredClone(creation);
      update(next);
      const nextVoxel = resetVoxel ? openVoxel(next.voxelId) : voxel;
      write(next, nextVoxel);
      creation = next; voxel = nextVoxel; version++;
    },
    // The active world has already committed in its own file. Reflect that
    // fact even when saving secondary creation metadata fails.
    reconcileWorld(update) {
      const next = structuredClone(creation);
      update(next);
      creation = next; version++;
      write(creation, voxel);
    },
    view() {
      return { ...structuredClone({ ...creation, source: creation.source ? { name: creation.source.name, characters: creation.source.text.length } : null }), voxel: voxel.state() };
    },
  };
}
