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

// Stored event ticks precede the snapshot's next simulation tick.
const sceneTick = (snapshot) => Math.max(...snapshot.events.map((event) => event.tick));

async function assertSpread(expectedTick) {
  await page.waitForFunction((tick) => {
    const left = document.querySelector("#leaf-left");
    const right = document.querySelector("#leaf-right");
    return left?.dataset.tick === String(tick) && right?.dataset.tick === String(tick) &&
      left.dataset.spread && left.dataset.spread === right.dataset.spread;
  }, expectedTick);
  const leaves = await page.locator("#leaf-left, #leaf-right").evaluateAll((nodes) => nodes.map((leaf) => {
    const contents = leaf.querySelectorAll(".spread-content");
    const content = contents[0];
    const rect = leaf.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();
    return {
      id: leaf.id, tick: leaf.dataset.tick, spread: leaf.dataset.spread,
      count: contents.length, text: content?.textContent,
      overflow: getComputedStyle(leaf).overflowX,
      leaf: { x: rect.x, right: rect.right, width: rect.width },
      content: contentRect && { x: contentRect.x, right: contentRect.right, width: contentRect.width },
    };
  }));
  assert.equal(leaves.length, 2);
  const [left, right] = leaves;
  assert.equal(left.tick, String(expectedTick));
  assert.equal(right.tick, left.tick, "both leaves must show the same tick");
  assert.ok(left.spread, "scene spread needs an identity");
  assert.equal(right.spread, left.spread, "both leaves must show the same scene spread");
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 4,
    `${label}: expected ${expected}, got ${actual}`);
  for (const leaf of leaves) {
    assert.equal(leaf.count, 1, `${leaf.id} must contain exactly one continuous scene`);
    assert.ok(leaf.leaf.width > 200, `${leaf.id} must be visible`);
    assert.ok(["hidden", "clip"].includes(leaf.overflow), `${leaf.id} must clip its half of the scene`);
    near(leaf.content.width, leaf.leaf.width * 2, `${leaf.id} full spread width`);
  }
  near(left.content.x, left.leaf.x, "left leaf shows the beginning of the scene");
  near(right.content.right, right.leaf.right, "right leaf shows the end of the scene");
  near(right.leaf.x - right.content.x, right.leaf.width, "right leaf skips the left half instead of repeating it");
  assert.equal(left.text, right.text, "both clipped halves must contain the same scene narrative");
  return left.spread;
}

async function assertNormalPaperTurn(snapshot) {
  const reducedPage = page;
  const normal = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "no-preference",
    recordVideo: { dir: artifact("paper-video"), size: { width: 1440, height: 1000 } },
  });
  const posts = [];
  const frames = {};
  normal.on("page", (opened) => opened.on("pageerror", (error) => pageErrors.push({ url: opened.url(), error: error.stack || String(error) })));
  // Reuse only the disposable rules fixture; unexpected writes must never reach the server.
  await normal.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      posts.push(new URL(req.url()).pathname);
      await route.abort();
    } else if (new URL(req.url()).pathname === "/api/world") {
      await route.fulfill({ json: snapshot });
    } else {
      await route.continue();
    }
  });
  const tick = sceneTick(snapshot);
  const clean = () => page.waitForFunction(() => {
    const curl = document.querySelector("#curl");
    return (!curl || curl.hidden) && !curl?.querySelector(".page-strip, .paper-ink");
  }, null, { timeout: 5000 });
  const visibleCurl = () => page.waitForFunction(() => {
    const curl = document.querySelector("#curl");
    return curl && !curl.hidden && curl.querySelectorAll(".page-strip").length >= 16;
  }, null, { timeout: 5000 });
  const actorDialog = async () => {
    // Choose a token in the visible half of a clipped scene, not its offscreen twin.
    const actor = await page.locator("#leaf-left .scene-person, #leaf-right .scene-person").evaluateAll((nodes) => {
      return nodes.findIndex((node) => {
        const box = node.getBoundingClientRect();
        const leaf = node.closest(".leaf").getBoundingClientRect();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        return x > leaf.left && x < leaf.right && y > leaf.top && y < leaf.bottom &&
          node.contains(document.elementFromPoint(x, y));
      });
    });
    assert.ok(actor >= 0, "a scene character must be clickable after turning");
    await page.locator("#leaf-left .scene-person, #leaf-right .scene-person").nth(actor).click();
    await page.locator("#dossier[open]").waitFor({ state: "visible" });
    await page.locator("#dossier-close").click();
    await page.locator("#dossier[open]").waitFor({ state: "detached" });
  };
  const turn = async (direction, expectedTick) => {
    // Observe in the browser from before the click, so CI round trips cannot lose early frames.
    await page.evaluate(() => {
      window.__paperFrames = [];
      let started = false;
      const deadline = performance.now() + 4000;
      const sample = () => {
        const curl = document.querySelector("#curl");
        const strips = curl && !curl.hidden ? [...curl.querySelectorAll(".page-strip")] : [];
        if (strips.length) {
          started = true;
          const first = getComputedStyle(strips[0]).transform;
          const last = getComputedStyle(strips.at(-1)).transform;
          const rotation = (transform) => {
            const matrix = new DOMMatrixReadOnly(transform === "none" ? undefined : transform);
            return [matrix.m11, matrix.m13, matrix.m31, matrix.m33];
          };
          window.__paperFrames.push({
            progress: Number(curl.dataset.progress),
            first, last, firstRotation: rotation(first), lastRotation: rotation(last),
          });
        }
        if (performance.now() < deadline && (!started || strips.length)) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const selector = direction === "back" ? "#turn-back" : "#turn-next";
    await page.locator(selector).click();
    await visibleCurl();
    const structure = await page.locator("#curl").evaluate((curl) => ({
      direction: curl.dataset.direction,
      hidden: curl.getAttribute("aria-hidden"), inert: curl.inert,
      faces: [...curl.querySelectorAll(".page-strip")].every((strip) =>
        [".paper-front", ".paper-back"].every((side) => {
          const face = strip.querySelector(side);
          const inks = face?.querySelectorAll(".paper-ink");
          return inks?.length === 1 && inks[0].children.length > 0 &&
            Boolean(inks[0].closest("[inert]")) && Boolean(inks[0].closest('[aria-hidden="true"]'));
        })),
      uniqueIds: (() => {
        const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
        return new Set(ids).size === ids.length;
      })(),
    }));
    assert.deepEqual(structure, { direction, hidden: "true", inert: true, faces: true, uniqueIds: true });
    // Dispatch a tight burst while turning; locator.click could wait until the lock clears.
    await page.locator(selector).evaluate((button) => { for (let i = 0; i < 5; i += 1) button.click(); });
    await page.waitForFunction(() => {
      const curl = document.querySelector("#curl");
      const progress = Number(curl?.dataset.progress);
      return curl && !curl.hidden && progress >= 0.25 && progress <= 0.7;
    }, null, { timeout: 3000 });
    await page.screenshot({ path: artifact(`paper-turn-${direction}-mid.png`), animations: "allow" });
    await clean();
    await assertSpread(expectedTick);
    const samples = await page.evaluate(() => window.__paperFrames);
    frames[direction] = samples;
    assert.ok(samples.length >= 3, `${direction}: collect at least three RAF frames`);
    assert.ok(samples.every(({ progress }) => Number.isFinite(progress) && progress >= 0 && progress <= 1));
    assert.ok(samples.every((sample, i) => !i || sample.progress >= samples[i - 1].progress), "progress must be monotonic");
    assert.ok(new Set(samples.map(({ progress }) => progress)).size >= 3, "progress must advance");
    for (const side of ["first", "last"]) {
      assert.ok(new Set(samples.map((sample) => sample[side])).size >= 3, `${side} strip must move`);
    }
    assert.ok(samples.some(({ firstRotation, lastRotation }) =>
      firstRotation.some((value, i) => Math.abs(value - lastRotation[i]) > 0.01)),
    "first and last strips must have different rotations, not just different translations");
    assert.deepEqual(posts, [], "history turning and rapid clicks must never POST");
  };
  try {
    await openWorld(normal, snapshot);
    await assertSpread(tick);
    await turn("back", tick - 1);
    await actorDialog();
    await turn("forward", tick);
    await actorDialog();

    // Cancellation may commit or roll back; both leaves must agree and input must recover.
    for (const interruption of ["resize", "map"]) {
      await page.locator("#turn-back").click();
      await visibleCurl();
      if (interruption === "resize") await page.setViewportSize({ width: 1400, height: 960 });
      else await page.locator("#book-tab").click();
      await clean();
      if (interruption === "map") await page.locator("#book-tab").click();
      const landed = Number(await page.locator("#leaf-left").getAttribute("data-tick"));
      assert.ok([tick, tick - 1].includes(landed), `${interruption}: cancellation must stay within this turn`);
      await assertSpread(landed);
      await actorDialog();
      if (landed !== tick) {
        await page.locator("#turn-next").click();
        await clean();
      }
      await assertSpread(tick);
    }
    assert.deepEqual(posts, [], "normal-motion checks must be read-only");
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: artifact("paper-turn-failure.png") }).catch(() => {});
    throw error;
  } finally {
    await writeFile(artifact("paper-turn-frames.json"), JSON.stringify(frames, null, 2));
    await normal.close();
    page = reducedPage;
  }
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
  const retryCreated = await retried.json();
  assert.equal(retryCreated.mode, "rules");
  assert.notEqual(retryCreated.world_id, initial.world_id);
  await page.unroute("**/api/worlds", failOnce);
  await poll("retry world visible", async () => (await page.locator("#world-name").textContent()) === retryCreated.name);

  // waiting is a recoverable failure, not busy: both retry and manual step stay enabled.
  const blocked = { ...retryCreated, simulation: { ...retryCreated.simulation, running: false, waiting: true, error: "SMOKE_BLOCKED" } };
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

  // Independent synthetic-only world: real CI Ray ticks, no model or mocked tick response.
  await page.close();
  const created = await json("/api/worlds", {
    text: "CI连续跨页验收：一座建在巨兽背上的城市，守城人和商人互相不信任，城门在日落前关闭。",
    use_model: false,
  });
  assert.equal(created.mode, "rules");
  assert.equal(created.tick, 0);
  assert.notEqual(created.world_id, retryCreated.world_id);
  let latest = created;
  for (let index = 0; index < 3; index += 1) {
    const previous = latest;
    latest = await json("/api/world/tick", {});
    assert.equal(latest.world_id, created.world_id);
    assert.equal(latest.mode, "rules");
    assert.equal(latest.tick, previous.tick + 1, "each manual API tick advances exactly once");
  }
  const networkCounts = { tickPosts: 0 };
  context.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/world/tick" && request.method() === "POST") {
      networkCounts.tickPosts += 1;
    }
  });
  const restored = await openWorld(context, latest);
  assert.equal(restored.tick, latest.tick);
  assert.equal(await page.locator("[data-view='3d'], #world3d").count(), 0, "3D view and canvas must be removed");
  const latestTick = sceneTick(latest);
  assert.ok(latestTick > 0, "fixture must contain multiple stored scene ticks");
  const latestSpread = await assertSpread(latestTick);
  assert.equal(networkCounts.tickPosts, 0, "opening the latest spread must not advance time");

  await page.locator("#turn-back").click();
  const previousSpread = await assertSpread(latestTick - 1);
  assert.notEqual(previousSpread, latestSpread, "back must select the preceding tick spread");
  assert.equal(networkCounts.tickPosts, 0, "reading the preceding tick must not POST a tick");
  await page.locator("#turn-next").click();
  assert.equal(await assertSpread(latestTick), latestSpread);
  assert.equal(networkCounts.tickPosts, 0, "forward through recorded history must not POST a tick");
  assert.equal((await json("/api/world")).tick, latest.tick, "history navigation must preserve simulation time");
  await page.screenshot({ path: artifact("03-story-spread.png"), fullPage: true });

  await assertNormalPaperTurn(latest);

  const tickResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/world/tick" && response.request().method() === "POST");
  await page.locator("#turn-next").click();
  const ticked = await tickResponse;
  assert.ok(ticked.ok(), "forward at the latest spread should advance the simulation");
  const nextSnapshot = await ticked.json();
  assert.equal(nextSnapshot.world_id, created.world_id);
  assert.equal(nextSnapshot.tick, latest.tick + 1);
  assert.equal(sceneTick(nextSnapshot), latestTick + 1);
  await assertSpread(latestTick + 1);
  assert.equal((await json("/api/world")).tick, nextSnapshot.tick);
  assert.equal(networkCounts.tickPosts, 1, "only forward at the latest spread may POST, exactly once");

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
