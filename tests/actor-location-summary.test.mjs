import test from 'node:test';
import assert from 'node:assert/strict';
import { actorLocationSummary } from '../residents/actor-location-summary.mjs';

test('actor location summary reports semantic place without inventing coordinates', () => {
  const world = {
    places: [{ id: 'lake', name: '湖' }],
    actors: [{ id: 'watchmaker', name: '修表老人', location: 'lake' }],
  };
  assert.equal(actorLocationSummary(world), '人物地点（地点级）：修表老人：湖');
});

test('actor location summary reports unmatched locations instead of guessing', () => {
  const world = { places: [], actors: [{ id: 'watchmaker', name: '修表老人', location: 'unknown' }] };
  assert.equal(actorLocationSummary(world), '人物地点（地点级）：修表老人：地点未匹配');
});

test('actor location summary handles worlds without people', () => {
  assert.equal(actorLocationSummary({ actors: [] }), '人物地点（地点级）：暂无人物。');
});
