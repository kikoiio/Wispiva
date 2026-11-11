import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createStoryServer } from '../server.mjs';

if (!process.env.CI) throw new Error('故事世界的浏览器验收请在已获授权的 GitHub Actions 中运行。');
const output = resolve('.tmp/story-world/browser'); mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(output, 'state-'));
const errors = [], checks = [], screenshots = [];
let calls = 0, server, browser, page;
const options = {
  stateFile: join(temporary, 'chat.json'),
  configLoader: () => ({ llm: { baseUrl: 'https://fixture.invalid/v1', model: 'offline-story-browser', apiKey: 'synthetic-only' } }),
  invokeModel: async ({ signal, onProgress, messages }) => {
    calls++;
    const cancelExample = messages.at(-1).content.includes('停止测试');
    onProgress?.({ phase: 'receiving', elapsedMs: 10, preview: cancelExample ? '未完成的回复' : '红发会的报酬是每周四英镑。' });
    try { await delay(cancelExample ? 5000 : 200, null, { signal }); }
    catch { return { ok: false, audit: { error: { code: 'cancelled' } } }; }
    return { ok: true, content: '红发会的报酬是每周四英镑。' };
  },
};
const settle = async () => {
  await page.waitForFunction(() => document.querySelector('#scene-host')?.dataset.rendered === 'true');
  await delay(800);
};
const shot = async name => { await settle(); const filename = `${name}.png`; await page.screenshot({ path: join(output, filename) }); screenshots.push(filename); };
const focus = async id => {
  await page.locator('#place-select').selectOption(id);
  await page.waitForFunction(value => document.querySelector('#scene-host').dataset.place === value, id);
};
const send = async message => {
  await page.locator('#message-input').fill(message); await page.locator('#send-button').click();
  await page.waitForFunction(() => !document.querySelector('#message-input').disabled && !document.querySelector('#message-input').value);
};
try {
  ({ server } = createStoryServer(options));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--disable-dev-shm-usage', '--ozone-platform=x11'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(address); await page.locator('#scene-loading').waitFor({ state: 'hidden', timeout: 90000 });
  assert.equal(await page.locator('#scene-error').isVisible(), false);
  await shot('01-world-overview'); assert.equal(calls, 0); checks.push('opening and rendering do not call a model');
  await focus('coburg-square'); await shot('02-coburg-square');
  await focus('sitting-room'); assert.equal(await page.locator('#cutaway-button').getAttribute('aria-pressed'), 'true'); await shot('03-baker-sitting-room');
  await focus('pawnshop'); await shot('04-pawnshop');
  await focus('league-office'); await shot('05-league-office');
  await focus('tunnel'); await shot('06-tunnel');
  await focus('bank-vault'); await page.locator('#chapter-select').selectOption('heist'); await shot('07-bank-vault-night');
  checks.push('all principal story rooms can be focused, with automatic interior cutaway');
  await page.locator('#walking-button').click();
  await page.waitForFunction(() => document.querySelector('#scene-host').dataset.walking === 'true');
  await shot('08-vault-walking');
  await page.locator('#scene-host canvas').focus(); await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#walking-button').getAttribute('aria-pressed') === 'false');
  checks.push('walking and Escape synchronize visible control state');
  await page.locator('#overview-button').click(); await page.locator('#chapter-select').selectOption('investigation');
  await send('去当铺地下室'); assert.equal(await page.locator('#place-select').inputValue(), 'pawn-cellar'); assert.equal(calls, 0);
  assert.equal(await page.locator('.message.user .message-copy', { hasText: '去当铺地下室' }).count(), 1);
  checks.push('chat navigation works locally and renders each message once');
  await send('红发会的报酬是多少？'); assert.equal(calls, 1);
  assert.equal(await page.locator('.message.assistant .message-copy', { hasText: '每周四英镑' }).count(), 1);
  await page.locator('#message-input').fill('停止测试'); await page.locator('#send-button').click();
  await page.locator('.message.pending .message-copy', { hasText: '未完成的回复' }).waitFor({ state: 'visible' });
  await page.locator('#cancel-button').click();
  await page.waitForFunction(() => !document.querySelector('#message-input').disabled);
  assert.equal(await page.locator('.message.assistant .message-copy', { hasText: '未完成的回复' }).count(), 0);
  checks.push('cancelled synthetic response is never committed as assistant history');
  const count = await page.locator('.message').count();
  await page.reload(); await page.locator('#scene-loading').waitFor({ state: 'hidden', timeout: 90000 });
  await page.waitForFunction(expected => document.querySelectorAll('.message').length === expected, count);
  assert.equal(calls, 2); checks.push('refresh restores conversation without a new model call');
  await page.setViewportSize({ width: 390, height: 844 }); await focus('coburg-square'); await shot('09-mobile');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  const composer = await page.locator('#chat-form').boundingBox(); assert(composer.y + composer.height <= 845);
  checks.push('mobile world and composer fit within the viewport');
  assert.deepEqual(errors, []);
  writeFileSync(join(output, 'observation.json'), JSON.stringify({ checks, screenshots, syntheticModelCalls: calls, browserErrors: errors }, null, 2));
  console.log(JSON.stringify({ checks, screenshots, syntheticModelCalls: calls }, null, 2));
} finally {
  if (errors.length) writeFileSync(join(output, 'errors.json'), JSON.stringify(errors, null, 2));
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
}
