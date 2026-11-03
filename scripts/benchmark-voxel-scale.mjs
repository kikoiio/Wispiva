import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createVoxelWorldStore } from '../voxel-world.mjs';
import { voxelContext } from '../creation-dialogue.mjs';

const root = resolve('.tmp/prototype');
const sizes = process.argv.slice(2).map(Number).filter(Number.isSafeInteger);
const counts = sizes.length ? sizes : [756, 5000];

function snapshot(count) {
  const width = Math.ceil(Math.sqrt(count));
  const cells = [];
  for (let index = 0; index < count; index += 1) {
    const x = index % width;
    const z = Math.floor(index / width);
    cells.push({ position: [x, 0, z], material: x < width / 2 ? 'wood' : 'grass' });
  }
  return { revision: 3, cells, objects: [], undo: [], redo: [] };
}

mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, 'voxel-scale-'));
try {
  for (const count of counts) {
    if (count < 1 || count > 5000) throw new Error(`count must be 1..5000: ${count}`);
    const file = join(directory, `${count}.json`);
    const started = performance.now();
    writeFileSync(file, `${JSON.stringify(snapshot(count))}\n`);
    const store = createVoxelWorldStore({ file });
    const state = store.state();
    const context = voxelContext(state);
    const contextBytes = Buffer.byteLength(JSON.stringify(context));
    const savedBytes = statSync(file).size;
    const reloaded = createVoxelWorldStore({ file }).state();
    const loadedMs = performance.now() - started;
    console.log(JSON.stringify({ count, revision: state.revision, regions: context.regions?.length ?? null,
      contextBytes, savedBytes, loadedCells: reloaded.cells.length, elapsedMs: Math.round(loadedMs * 10) / 10 }));
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
