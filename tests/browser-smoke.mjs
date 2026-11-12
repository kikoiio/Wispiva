/** CI-only smoke: run against scripts/run.sh and the disposable Redis DB 15. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, request } from "playwright";

assert.equal(process.env.CI, "true", "Browser/Ray smoke runs only in CI.");
assert.equal(process.env.REDIS_URL, "redis://127.0.0.1:6379/15", "Use the disposable CI Redis DB 15.");
const baseURL = "http://127.0.0.1:4173";
const artifacts = new URL("../.tmp/browser-artifacts/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const artifact = (name) => new URL(name, artifacts).pathname;
const api = await request.newContext({ baseURL, timeout: 10_000 });
const pageErrors = [];
let browser;
let page;
let result = { ok: false };

async function poll(label, check, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out: ${label}`);
}

async function json(path, options) {
  const response = options ? await api.post(path, { data: options }) : await api.get(path);
  assert.ok(response.ok(), `${path}: HTTP ${response.status()} ${await response.text()}`);
  return response.json();
}

async function openWorld(context, expected) {
  page = await context.newPage();
  const restored = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/world" && response.request().method() === "GET" && response.ok());
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  const payload = await (await restored).json();
  assert.equal(payload.world_id, expected.world_id, "GET must restore the same world");
  await page.locator("#world-name").waitFor({ state: "visible" });
  await poll("world name restored in UI", async () => (await page.locator("#world-name").textContent()) === expected.name);
  await page.waitForFunction(() => !document.querySelector("#play").disabled || !document.querySelector("#stop").disabled);
  return payload;
}

async function submit() {
  const response = page.waitForResponse((value) =>
    new URL(value.url()).pathname === "/api/worlds" && value.request().method() === "POST");
  await page.locator("#composer button[type='submit']").click();
  return response;
}

try {
  await poll("server readiness", async () => {
    try {
      const response = await api.get("/api/status");
      if (!response.ok()) return false;
      const status = await response.json();
      assert.equal(status.configured, false, "CI must not expose a real model configuration");
      return status.redis;
    } catch (error) {
      if (error.code === "ERR_ASSERTION") throw error;
      return false;
    }
  }, 60_000);

  const initial = await json("/api/worlds", { text: "CI规则验收：院子里的商人和学徒互相认识。", use_model: false });
  assert.equal(initial.mode, "rules");
  assert.ok(initial.actors.length > 0);

  const env = { ...process.env };
  delete env.WAYLAND_DISPLAY;
  browser = await chromium.launch({
    headless: true,
    env,
    args: ["--disable-gpu", "--ozone-platform=x11", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  context.on("page", (opened) => opened.on("pageerror", (error) => pageErrors.push({ url: opened.url(), error: error.stack || String(error) })));
  await openWorld(context, initial);

  // A synthetic failed creation must release busy controls and preserve the world.
  await page.locator("[data-view='lore']").click();
  await page.locator("#idea").fill("CI重试验收：市集里的商人和学徒互相认识。");
  assert.equal(await page.locator("#use-model").isChecked(), false);
  let failedCreation = false;
  const failOnce = async (route) => {
    if (route.request().method() === "POST" && !failedCreation) {
      failedCreation = true;
      assert.equal(route.request().postDataJSON().use_model, false);
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "SMOKE_CREATE_FAILED" }) });
    } else {
      await route.continue();
    }
  };
  await page.route("**/api/worlds", failOnce);
  assert.equal((await submit()).status(), 503);
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("SMOKE_CREATE_FAILED") &&
    !document.querySelector("#idea").disabled && !document.querySelector("#composer button[type='submit']").disabled);
  assert.equal((await json("/api/world")).world_id, initial.world_id);
  await page.screenshot({ path: artifact("01-create-failed-retry-enabled.png"), fullPage: true });
  const retried = await submit();
  assert.ok(retried.ok(), "retry creation should succeed");
  const created = await retried.json();
  assert.equal(created.mode, "rules");
  assert.notEqual(created.world_id, initial.world_id);
  await page.unroute("**/api/worlds", failOnce);
  await poll("retry world visible", async () => (await page.locator("#world-name").textContent()) === created.name);

  // waiting is a recoverable failure, not busy: both retry and manual step stay enabled.
  const blocked = { ...created, simulation: { ...created.simulation, running: false, waiting: true, error: "SMOKE_BLOCKED" } };
  const blockedSnapshot = (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(blocked) });
  await page.route("**/api/world", blockedSnapshot);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#play").textContent.includes("重试并运行") &&
    !document.querySelector("#play").disabled && !document.querySelector("#next").disabled);
  await page.screenshot({ path: artifact("02-blocked-retry-enabled.png"), fullPage: true });
  await page.unroute("**/api/world", blockedSnapshot);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector("#play").disabled &&
    !document.querySelector("#play").textContent.includes("重试并运行"));

  await page.locator("[data-view='3d']").click();
  const canvas3d = page.locator("canvas#world3d");
  await canvas3d.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas#world3d");
    if (!canvas?.width || !canvas.height) return false;
    const context = canvas.getContext("2d");
    if (!context) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let offset = 4; offset < pixels.length; offset += 4) {
      if (pixels[offset] !== pixels[0] || pixels[offset + 1] !== pixels[1] ||
          pixels[offset + 2] !== pixels[2] || pixels[offset + 3] !== pixels[3]) return true;
    }
    return false;
  });
  const beforeDataURL = await canvas3d.evaluate((canvas) => canvas.toDataURL());
  const bounds = await canvas3d.boundingBox();
  assert.ok(bounds && bounds.width > 200, "3D canvas needs room for the 100px orbit gesture");
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 100, center.y, { steps: 10 });
  await page.mouse.up();
  const afterDataURL = await canvas3d.evaluate(async (canvas) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return canvas.toDataURL();
  });
  assert.notEqual(afterDataURL, beforeDataURL, "orbit drag must change the rendered 3D scene");
  await page.screenshot({ path: artifact("03-world3d.png"), fullPage: true });
  await page.locator("[data-view='story']").click();

  const startedResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/world/run" && response.request().method() === "POST");
  await page.locator("#play").click();
  const started = await startedResponse;
  assert.ok(started.ok());
  const running = await started.json();
  assert.equal(running.simulation.running, true);
  await page.close();
  assert.equal(context.pages().length, 0, "background tick check must have no open viewer");
  const advanced = await poll("server advances with every viewer closed", async () => {
    const current = await json("/api/world");
    assert.equal(current.world_id, created.world_id);
    assert.equal(current.simulation.waiting, false, current.simulation.error);
    assert.equal(current.simulation.running, true);
    return current.tick >= running.tick + 2 ? current : false;
  }, 150_000);
  await openWorld(context, advanced);
  await page.waitForFunction((minimum) => Number(document.querySelector("#tick").textContent) >= minimum &&
    !document.querySelector("#stop").disabled && document.querySelector("#play").getAttribute("aria-pressed") === "true", advanced.tick);

  const stoppedResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/world/run" && response.request().method() === "POST");
  await page.locator("#stop").click();
  const stopped = await stoppedResponse;
  assert.ok(stopped.ok());
  const stopSnapshot = await stopped.json();
  assert.equal(stopSnapshot.simulation.running, false);
  // Stop may let one already-started atomic tick finish. Then require a quiet window.
  let lastTick = stopSnapshot.tick;
  let stableSince = Date.now();
  const quietWindow = Math.max(3000, Number(stopSnapshot.simulation.interval) * 2500);
  const frozen = await poll("stopped world stays frozen", async () => {
    const current = await json("/api/world");
    assert.equal(current.simulation.running, false);
    assert.ok(current.tick <= stopSnapshot.tick + 1, "stop permitted more than one in-flight tick");
    if (current.tick !== lastTick) {
      lastTick = current.tick;
      stableSince = Date.now();
    }
    return Date.now() - stableSince >= quietWindow ? current : false;
  }, 30_000);
  await delay(quietWindow);
  assert.equal((await json("/api/world")).tick, frozen.tick, "ticks resumed after stop");

  const query = `world_id=${encodeURIComponent(created.world_id)}`;
  const history = await json(`/api/world/history?${query}&limit=100`);
  const entry = history.entries.find((value) => value.revision === created.revision);
  assert.ok(entry, "creation revision missing from history");
  const historical = await json(`/api/world/history/${entry.revision}?${query}`);
  assert.equal(historical.historical, true);
  assert.equal(historical.world_id, created.world_id);
  assert.equal(historical.revision, created.revision);
  assert.equal(historical.tick, created.tick);
  assert.deepEqual(historical.actors, created.actors, "creation checkpoint changed after later ticks");
  await page.screenshot({ path: artifact("04-stopped-restored-world.png"), fullPage: true });
  assert.deepEqual(pageErrors, [], "browser pageerror detected");
  result = { ok: true, mode: "rules", world_id: created.world_id, backgroundTick: advanced.tick, stoppedTick: frozen.tick, historyRevision: historical.revision };
  console.log(JSON.stringify(result));
} catch (error) {
  result = { ok: false, error: error.stack || String(error) };
  if (page && !page.isClosed()) await page.screenshot({ path: artifact("failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(artifact("result.json"), JSON.stringify({ ...result, pageErrors }, null, 2));
  await browser?.close();
  await api.dispose();
}
