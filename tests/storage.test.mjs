import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJSON, writeJSONAtomic } from '../storage/files.mjs';
import { createWorldRepository } from '../storage/world-repository.mjs';

test('failed atomic saves preserve the destination and clean their temporary files', () => {
  const folder = mkdtempSync(join(tmpdir(), 'wispiva-storage-'));
  try {
    const destination = join(folder, 'state.json');
    writeJSONAtomic(destination, { revision: 1 });
    const before = readFileSync(destination, 'utf8');
    assert.throws(() => writeJSONAtomic(destination, { invalid: undefined }, { validateJSON: true }), /non-json-save/);
    assert.equal(readFileSync(destination, 'utf8'), before);
    const blocked = join(folder, 'blocked.json');
    mkdirSync(blocked);
    writeFileSync(join(blocked, 'untouched'), 'keep');
    assert.throws(() => writeJSONAtomic(blocked, { revision: 2 }));
    assert.equal(readFileSync(join(blocked, 'untouched'), 'utf8'), 'keep');
    assert.deepEqual(readdirSync(folder).sort(), ['blocked.json', 'state.json']);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('creation snapshots retain all committed data and reject corrupt saves without replacing them', () => {
  const folder = mkdtempSync(join(tmpdir(), 'wispiva-repository-'));
  try {
    const repository = createWorldRepository(join(folder, 'state.json'));
    assert.equal(repository.readCreation(), null);
    const saved = { schemaVersion: 1, dialogue: { revision: 3 }, voxelSnapshot: { revision: 4, undo: [{ cells: [] }], redo: [] } };
    repository.saveCreation(saved);
    assert.deepEqual(repository.readCreation(), saved);
    const file = join(folder, 'creation.json');
    writeFileSync(file, '{damaged');
    assert.throws(() => repository.readCreation(), /原文件已保留/);
    assert.equal(readFileSync(file, 'utf8'), '{damaged');
    writeFileSync(file, '{"schemaVersion":99}');
    assert.throws(() => repository.readCreation(), /原文件已保留/);
    assert.equal(readJSON(file).schemaVersion, 99);
    assert.throws(() => repository.archiveFile('../outside'), /归档标识无效/);
    assert.throws(() => repository.voxelFile('../outside'), /草稿标识无效/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
