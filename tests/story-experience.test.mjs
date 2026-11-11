import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryExperience } from '../creation/story-experience.mjs';

const noModel = () => { throw new Error('not configured'); };
const configured = () => ({ llm: { baseUrl: 'https://example.invalid/v1', model: 'offline-test', apiKey: 'test-only' } });

test('opening the authored world and navigating never requests a model', async () => {
  let calls = 0;
  const story = createStoryExperience({ configLoader: noModel, invokeModel: () => { calls++; throw new Error('unexpected'); } });
  assert.equal(story.state().model.configured, false);
  const result = await story.chat({ message: '带我去当铺地下室', chapter: 'investigation' });
  assert.equal(result.ok, true); assert.equal(result.focus, 'pawn-cellar'); assert.equal(calls, 0);
  assert.equal(result.messages.length, 2);
  assert.deepEqual(Object.keys(story.state().model), ['configured']);
  const night = await story.chat({ message: '看看银行之夜的金库' });
  assert.equal(night.chapter, 'heist'); assert.equal(night.focus, 'bank-vault');
});

test('a question does not unexpectedly move the camera or claim to build', async () => {
  let request;
  const story = createStoryExperience({ configLoader: configured, invokeModel: async args => {
    request = args; return { ok: true, content: '银行在当铺背后，面向另一条街道。' };
  } });
  const result = await story.chat({ message: '为什么银行在当铺背后？', placeId: 'pawnshop', chapter: 'investigation' });
  assert.equal(result.ok, true); assert.equal(result.focus, undefined);
  assert.equal(request.jsonMode, false); assert.match(request.messages[0].content, /每周四英镑/);
  assert.match(request.messages[0].content, /三万枚拿破仑金币/);
  assert.equal(result.messages.filter(item => item.role === 'assistant').length, 1);
  assert(!JSON.stringify(story.state()).includes('test-only'));
});

test('invalid places and oversized messages do not enter conversation history', async () => {
  const story = createStoryExperience({ configLoader: noModel });
  assert.equal((await story.chat({ message: '去当铺', placeId: 'missing' })).ok, false);
  assert.equal((await story.chat({ message: 'a'.repeat(4001) })).ok, false);
  assert.equal((await story.chat({ message: '你好', chapter: 'invalid' })).ok, false);
  assert.equal(story.state().messages.length, 0);
  assert.equal((await story.chat({ message: '谁是克莱？' })).reason, 'model-unconfigured');
});

test('cancellation retains the user message and discards partial assistant output', async () => {
  let announce;
  const started = new Promise(resolve => { announce = resolve; });
  const story = createStoryExperience({ configLoader: configured, invokeModel: async ({ signal, onProgress }) => {
    onProgress({ phase: 'receiving', preview: '未完成的回复', elapsedMs: 20 }); announce();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return { ok: true, content: '未完成的回复' };
  } });
  const pending = story.chat({ message: '请讲讲这个故事', placeId: 'sitting-room' });
  await started;
  assert.equal(story.state().busy, true);
  assert.equal((await story.chat({ message: '去当铺' })).ok, false);
  story.cancel();
  const result = await pending;
  assert.equal(result.reason, 'cancelled'); assert.equal(story.state().busy, false);
  assert.deepEqual(result.messages, [{ role: 'user', content: '请讲讲这个故事' }]);
});
