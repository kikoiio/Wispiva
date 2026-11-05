import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, renameSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrototypeExperience } from '../server.mjs';
import { createGeneratedFixture } from '../simulation/world-definition.mjs';

test('a failed source change preserves the current source and conversation revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wispiva-control-'));
  const file = join(directory, 'creation.json'), backup = join(directory, 'durable.json');
  const experience = createPrototypeExperience({ stateFile: join(directory, 'state.json'), configLoader() { assert.fail('Control must not call the model'); } });
  try {
    experience.control({ type: 'source-set', source: { name: 'saved.txt', text: '已保存的素材' } });
    const before = experience.state().creation;
    const durable = readFileSync(file, 'utf8');
    renameSync(file, backup); mkdirSync(file);
    try {
      assert.throws(() => experience.control({ type: 'source-set', source: { name: 'unsaved.txt', text: '没有保存成功的素材' } }));
      assert.deepEqual(experience.state().creation, before, 'Failed save must not publish the new source or invalidate the conversation');
    } finally { rmSync(file, { recursive: true }); renameSync(backup, file); }
    assert.equal(readFileSync(file, 'utf8'), durable);
  } finally { experience.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a failed reset preserves the draft identity and its saved source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wispiva-reset-'));
  const file = join(directory, 'creation.json'), backup = join(directory, 'durable.json');
  const experience = createPrototypeExperience({ stateFile: join(directory, 'state.json') });
  try {
    experience.control({ type: 'source-set', source: { name: 'saved.txt', text: '保留这份起点素材' } });
    const before = experience.state().creation;
    renameSync(file, backup); mkdirSync(file);
    try {
      assert.throws(() => experience.control({ type: 'reset' }));
      assert.deepEqual(experience.state().creation, before);
    } finally { rmSync(file, { recursive: true }); renameSync(backup, file); }
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).voxelId, before.voxelId);
  } finally { experience.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('an installed world cannot become an actionable old draft when its creation metadata save fails', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wispiva-confirm-'));
  const file = join(directory, 'creation.json'), backup = join(directory, 'durable.json');
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, mode: 'create', draft: { id: 'draft', description: '起点', definition: createGeneratedFixture() } }));
  const experience = createPrototypeExperience({ stateFile: join(directory, 'state.json') });
  try {
    renameSync(file, backup); mkdirSync(file);
    try {
      assert.throws(() => experience.control({ type: 'world-accept', draftId: 'draft' }));
      const current = experience.state();
      assert.equal(current.creation.hasWorld, true);
      assert.equal(current.genesis.draftId, 'draft');
      assert.equal(current.creation.mode, 'world', 'A committed active world must remain visible after metadata save failure');
      assert.equal(current.creation.draft, null, 'The installed origin must not remain available for a duplicate confirmation');
      assert.equal(experience.control({ type: 'world-accept', draftId: 'draft' }).ok, false);
    } finally { rmSync(file, { recursive: true }); renameSync(backup, file); }
  } finally { experience.close(); rmSync(directory, { recursive: true, force: true }); }
});
