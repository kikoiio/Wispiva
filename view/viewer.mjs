import { buildSpreads, endCursor } from "./story.mjs";

const PAINTED = {
  城门: { label: [16, 17], feet: [20, 40] },
  市集: { label: [22, 46], feet: [36, 74] },
  巨兽背: { label: [58, 56], feet: [58, 70] },
  兽脊: { label: [54, 12], feet: [56, 32] },
  汲水处: { label: [86, 54], feet: [74, 74] },
  夜瞭台: { label: [88, 18], feet: [86, 42] },
};

const KIND = { trust: "信任", distrust: "不信任", knows: "认识" };

const atlas = document.querySelector("#atlas");
const placesLayer = document.querySelector("#places");
const peopleLayer = document.querySelector("#people");
const bubbleLayer = document.querySelector("#bubbles");
const latest = document.querySelector("#latest");
const mind = document.querySelector("#mind");
const drawer = document.querySelector("#drawer");
const lore = document.querySelector("#lore");
const castView = document.querySelector("#cast-view");
const composer = document.querySelector("#composer");
const composerSlot = document.querySelector("#composer-slot");
const empty = document.querySelector("#empty");
const status = document.querySelector("#status");
const simulationStatus = document.querySelector("#simulation-status");
const tickLabel = document.querySelector("#tick");
const worldName = document.querySelector("#world-name");
const worldPlaque = document.querySelector("#world-plaque");
const idea = document.querySelector("#idea");
const useModel = document.querySelector("#use-model");
const nextButton = document.querySelector("#next");
const playButton = document.querySelector("#play");
const stopButton = document.querySelector("#stop");
const addButton = document.querySelector("#add-agent");
const removeButton = document.querySelector("#remove-agent");
const agentName = document.querySelector("#agent-name");
const dossier = document.querySelector("#dossier");

const leafLeft = document.querySelector("#leaf-left");
const leafRight = document.querySelector("#leaf-right");
const curl = document.querySelector("#curl");
const curlFront = document.querySelector("#curl-front-sheet");
const curlBack = document.querySelector("#curl-back-sheet");
const turnBack = document.querySelector("#turn-back");
const turnNext = document.querySelector("#turn-next");
const bookTab = document.querySelector("#book-tab");
const sceneChoices = document.querySelector("#scene-choices");

let world = null;
let view = "story";
let selected = null;
let playing = false;
let ticking = false;
let busy = false;
let pendingText = "";
let modelConfigured = false;
let connectionNotice = "";
let configurationNotice = "";
let actionNotice = "";
let polling = false;
let pages = [];
let cursor = 0;
let pinnedToEnd = true;
let showAtlas = false;
let turning = false;
const sceneByTick = new Map();
const stood = new Map();

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
composer.addEventListener("submit", (event) => {
  event.preventDefault();
  void createWorld();
});
document.querySelector("#join").addEventListener("submit", (event) => {
  event.preventDefault();
  void addAgent();
});
nextButton.addEventListener("click", () => { void stepOnce(); });
playButton.addEventListener("click", () => { void play(); });
stopButton.addEventListener("click", () => { void stopPlay(); });
turnBack.addEventListener("click", () => { void flip(-1); });
turnNext.addEventListener("click", () => { void flip(1); });
bookTab.addEventListener("click", () => setView(showAtlas ? "story" : "map"));
window.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  event.preventDefault();
  void flip(event.key === "ArrowRight" ? 1 : -1);
});
removeButton.addEventListener("click", () => { void removeAgent(); });
document.querySelector("#dossier-close").addEventListener("click", () => dossier.close());

placeComposer();
void initialize();
window.setInterval(() => { void refreshWorld(); }, 800);

async function initialize() {
  try {
    const info = await requestJson("/api/status");
    modelConfigured = Boolean(info.configured);
    useModel.disabled = busy || !modelConfigured;
    if (!modelConfigured) useModel.checked = false;
    if (!modelConfigured && !useModel.closest("label").dataset.noteAdded) {
      useModel.closest("label").append("（还没有配置）");
      useModel.closest("label").dataset.noteAdded = "true";
    }
  } catch (error) {
    useModel.disabled = true;
    useModel.checked = false;
    configurationNotice = `无法读取服务配置：${error.message}`;
  }

  try {
    const existing = await requestJson("/api/world");
    showWorld(existing, { animate: false });
  } catch (error) {
    if (error.status !== 404) connectionNotice = `无法载入世界：${error.message}`;
  }
  renderSimulationStatus();
  if (location.hash === "#lore" || location.hash === "#cast") setView(location.hash.slice(1));
}

async function requestJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(error?.message ? `无法连接服务：${error.message}` : "无法连接服务。");
  }
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Keep the HTTP status visible when the server has no JSON error body.
  }
  if (!response.ok) {
    const error = new Error(payload.error || `请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function refreshWorld() {
  if (polling || busy || ticking || turning) return;
  polling = true;
  try {
    const snapshot = await requestJson("/api/world");
    connectionNotice = "";
    if (!world || JSON.stringify(snapshot) !== JSON.stringify(world)) {
      const advanced = Boolean(world && Number(snapshot.tick) > Number(world.tick));
      showWorld(snapshot, { animate: advanced });
    } else {
      if (playing && pinnedToEnd && view === "story" && cursor < endCursor(pages.length)) void slide(1);
      renderSimulationStatus();
    }
  } catch (error) {
    if (error.status !== 404) connectionNotice = `服务连接中断：${error.message}`;
    renderSimulationStatus();
  } finally {
    polling = false;
  }
}

function setView(next) {
  view = next;
  showAtlas = next === "map";
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  const open = view === "lore" || view === "cast";
  drawer.hidden = !open;
  lore.hidden = view !== "lore";
  castView.hidden = view !== "cast";
  if (open) placeComposer();
  renderBook();
}

function placeComposer() {
  const host = world && view === "lore" ? composerSlot : empty;
  host.append(composer);
  composer.classList.toggle("compact", Boolean(world));
}

async function createWorld() {
  if (busy) return;
  if (!idea.value.trim()) {
    status.textContent = "先写一句设想。";
    return;
  }
  setBusy(true);
  status.textContent = "正在生成。";
  try {
    const payload = await requestJson("/api/worlds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: idea.value, use_model: useModel.checked }),
    });
    actionNotice = "";
    status.textContent = "";
    selected = null;
    stood.clear();
    showWorld(payload, { animate: false });
    setView("story");
  } catch (error) {
    status.textContent = error.message;
    actionNotice = error.message;
    renderSimulationStatus();
  } finally {
    setBusy(false);
  }
}

async function stepOnce() {
  if (!world || busy || playing) return false;
  ticking = true;
  setBusy(true);
  showPending("角色正在决定这一拍。");
  try {
    const payload = await requestJson("/api/world/tick", { method: "POST" });
    actionNotice = "";
    pendingText = "";
    pinnedToEnd = true;
    showWorld(payload, { animate: true, defer: true });
    await curlTo(endCursor(pages.length), true);
    return true;
  } catch (error) {
    actionNotice = error.message || "这一拍没有走成。";
    showPending(actionNotice);
    return false;
  } finally {
    ticking = false;
    setBusy(false);
    renderSimulationStatus();
  }
}

async function addAgent() {
  if (!world || busy) return;
  const location = selected?.type === "location" ? selected.id : world.locations[0]?.id;
  setBusy(true);
  try {
    const payload = await requestJson("/api/world/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: agentName.value, location, goal: "刚加入这个世界" }),
    });
    actionNotice = "";
    agentName.value = "";
    showWorld(payload, { animate: false });
  } catch (error) {
    actionNotice = error.message || "没有加入。";
    status.textContent = actionNotice;
    renderSimulationStatus();
  } finally {
    setBusy(false);
  }
}

async function removeAgent() {
  if (busy || selected?.type !== "actor" || !world?.actors.some((actor) => actor.id === selected.id)) return;
  setBusy(true);
  try {
    const payload = await requestJson(`/api/world/agents/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
    actionNotice = "";
    stood.delete(selected.id);
    selected = null;
    showWorld(payload, { animate: false });
  } catch (error) {
    actionNotice = error.message || "没有离开。";
    status.textContent = actionNotice;
    renderSimulationStatus();
  } finally {
    setBusy(false);
  }
}

function showWorld(next, options) {
  const sameWorld = world && (world.world_id || world.name) === (next.world_id || next.name);
  const readingTick = pages[cursor]?.tick;
  const follow = sameWorld && pinnedToEnd && options.animate && next.simulation?.running && view === "story";
  world = next;
  document.body.classList.remove("is-empty");
  worldPlaque.hidden = false;
  worldName.textContent = world.name;
  tickLabel.textContent = String(world.tick);
  if (world.plate) {
    atlas.hidden = false;
    if (atlas.src !== new URL(world.plate, location.href).href) atlas.src = world.plate;
    atlas.alt = world.name;
  } else {
    atlas.hidden = true;
    atlas.removeAttribute("src");
  }
  pages = buildSpreads(world);
  if (!sameWorld) {
    sceneByTick.clear();
    cursor = endCursor(pages.length);
    pinnedToEnd = true;
  } else if (!options.defer) {
    const restored = pages.findIndex((page) => page.tick === readingTick);
    cursor = restored >= 0 ? restored : Math.min(cursor, endCursor(pages.length));
  }
  renderPlaces();
  renderPeople(options.animate);
  renderLore();
  renderCast();
  renderLatest();
  latest.hidden = true;
  renderMind();
  if (!options.defer) {
    if (follow && cursor < endCursor(pages.length)) void animateTurn(1, cursor + 1);
    else renderBook();
  }
  const ready = world.actors.length > 0;
  playing = Boolean(world.simulation?.running);
  pendingText = world.simulation?.waiting ? "等待恢复" : "";
  nextButton.disabled = busy || ticking || playing || !ready;
  syncPlayback(ready);
  addButton.disabled = busy || !world;
  agentName.disabled = busy || !world;
  removeButton.disabled = busy || selected?.type !== "actor" || !world.actors.some((actor) => actor.id === selected.id);
  renderSimulationStatus();
  placeComposer();
}

function anchorFor(location, index, count) {
  if (world.plate && PAINTED[location.name]) return PAINTED[location.name];
  const t = count <= 1 ? 0.5 : index / (count - 1);
  const x = 18 + t * 64;
  const y = 58 + Math.sin(t * Math.PI) * 8;
  return { label: [x, y - 16], feet: [x, y] };
}

function renderPlaces() {
  placesLayer.replaceChildren();
  world.locations.forEach((location, index) => {
    const spot = anchorFor(location, index, world.locations.length);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "plaque";
    if (shut(location)) button.classList.add("shut");
    if (selected?.type === "location" && selected.id === location.id) button.classList.add("selected");
    button.textContent = location.name;
    button.style.left = `${spot.label[0]}%`;
    button.style.top = `${spot.label[1]}%`;
    button.addEventListener("click", () => openPlace(location.id));
    placesLayer.append(button);
  });
}

function spotFor(placeId) {
  const index = world.locations.findIndex((item) => item.id === placeId);
  const location = world.locations[index];
  if (!location) return { label: [50, 36], feet: [50, 54] };
  return anchorFor(location, Math.max(0, index), world.locations.length);
}

function renderPeople(animate) {
  const groups = new Map();
  for (const actor of world.actors) {
    const list = groups.get(actor.place) || [];
    list.push(actor);
    groups.set(actor.place, list);
  }
  const ids = new Set(world.actors.map((actor) => actor.id));
  for (const id of stood.keys()) if (!ids.has(id)) stood.delete(id);
  peopleLayer.replaceChildren();
  bubbleLayer.replaceChildren();
  const marks = beatByActor();
  for (const [placeId, group] of groups) {
    const spot = spotFor(placeId);
    group.forEach((actor, slot) => {
      const previous = stood.get(actor.id);
      const origin = animate && previous && previous !== placeId ? spotFor(previous) : null;
      const shift = (slot - (group.length - 1) / 2) * 9;
      const here = spot.feet;
      const there = origin ? origin.feet : here;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "person";
      if (!origin) button.classList.add("instant");
      if (selected?.type === "actor" && selected.id === actor.id) button.classList.add("selected");
      button.style.left = `${there[0] + shift}%`;
      button.style.top = `${there[1]}%`;
      if (actor.image) {
        const image = document.createElement("img");
        image.alt = actor.name;
        image.src = actor.image;
        button.append(image);
      } else {
        const token = document.createElement("span");
        token.className = "token";
        token.textContent = actor.name.slice(0, 1);
        button.append(token);
      }
      button.addEventListener("click", () => openActor(actor.id));
      peopleLayer.append(button);
      const mark = marks.get(actor.id);
      const line = glance(mark, false);
      if (line) {
        const bubble = document.createElement("p");
        bubble.className = `map-bubble ${mark.ok ? mark.action : "failed"}`;
        bubble.textContent = line;
        bubble.style.left = `${here[0] + shift - 9}%`;
        bubble.style.top = `${here[1] - 7}%`;
        bubbleLayer.append(bubble);
      }
      stood.set(actor.id, placeId);
      if (origin) {
        requestAnimationFrame(() => {
          button.style.left = `${here[0] + shift}%`;
          button.style.top = `${here[1]}%`;
        });
      } else {
        requestAnimationFrame(() => button.classList.remove("instant"));
      }
    });
  }
}

function renderLore() {
  document.querySelector("#lore-title").textContent = world.name;
  document.querySelector("#lore-origin").textContent = world.origin || "";
  const rules = document.querySelector("#rules");
  rules.replaceChildren();
  const ruleItems = world.rules || [];
  if (!ruleItems.length) rules.append(item("还没有写成规则的限制。"));
  for (const rule of ruleItems) rules.append(item(typeof rule === "string" ? rule : rule.text));
  const relations = document.querySelector("#relations");
  relations.replaceChildren();
  if (!(world.relations || []).length) relations.append(item("还没有写明的关系。"));
  for (const relation of world.relations || []) {
    const kind = KIND[relation.kind] || relation.kind;
    relations.append(item(`${personName(relation.a)}与${personName(relation.b)}${kind}`));
  }
  const beats = document.querySelector("#beats");
  beats.replaceChildren();
  const events = (world.events || []).slice(-8).reverse();
  if (!events.length) beats.append(item("还没有人行动。"));
  for (const event of events) {
    const row = item(`第 ${event.tick + 1} 拍　${event.text}`);
    if (!event.ok) row.classList.add("failed");
    beats.append(row);
  }
}

function renderCast() {
  const list = document.querySelector("#cast");
  list.replaceChildren();
  for (const actor of world.actors) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cast-card";
    if (selected?.type === "actor" && selected.id === actor.id) button.classList.add("selected");
    if (actor.image) {
      const image = document.createElement("img");
      image.alt = "";
      image.src = actor.image;
      button.append(image);
    } else {
      const token = document.createElement("span");
      token.className = "token";
      token.textContent = actor.name.slice(0, 1);
      button.append(token);
    }
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = actor.name;
    const where = document.createElement("small");
    const memory = (actor.memory || []).at(-1);
    where.textContent = `${placeName(actor.place)}${memory ? ` · ${memory.text}` : ""}`;
    text.append(name, where);
    button.append(text);
    button.addEventListener("click", () => openActor(actor.id));
    row.append(button);
    list.append(row);
  }
}

function renderMind() {
  const model = world.model || {};
  if (model.error && model.used) {
    mind.hidden = false;
    mind.textContent = `${model.name || "模型"}决定了这一拍，有一个角色没有答上：${model.error}`;
    return;
  }
  if (model.error) {
    mind.hidden = false;
    mind.textContent = model.error;
    return;
  }
  mind.hidden = true;
}

function renderLatest() {
  const event = (world.events || []).at(-1);
  if (!event) {
    latest.hidden = true;
    return;
  }
  latest.hidden = false;
  latest.classList.toggle("failed", !event.ok);
  latest.textContent = event.text;
}

function openPlace(id) {
  selected = { type: "location", id };
  const location = world.locations.find((item) => item.id === id);
  const who = world.actors.filter((actor) => actor.place === id).map((actor) => actor.name);
  openDossier(location.name, accessText(location), who.length ? `${who.join("、")}在这里。` : "现在没有人在这里。");
  refreshSelection();
}

function openActor(id) {
  selected = { type: "actor", id };
  const actor = actorById(id);
  if (!actor) return;
  const memory = (actor.memory || []).map((item) => item.text).join(" ");
  openDossier(actor.name, placeName(actor.place), `${actor.goal || "还没有目标"}。${memory}`);
  refreshSelection();
}

function openDossier(title, kicker, body) {
  document.querySelector("#dossier-title").textContent = title;
  document.querySelector("#dossier-kicker").textContent = kicker;
  document.querySelector("#dossier-body").textContent = body;
  if (!dossier.open) dossier.showModal();
  removeButton.disabled = selected?.type !== "actor" || !world?.actors?.some((actor) => actor.id === selected.id);
}

function refreshSelection() {
  renderPlaces();
  renderPeople(false);
  renderCast();
  renderBook();
}

function focusLocation() {
  if (!playing && selected?.type === "location") {
    return world.locations.find((item) => item.id === selected.id) || world.locations[0];
  }
  if (!playing && selected?.type === "actor") {
    const actor = world.actors.find((item) => item.id === selected.id);
    return world.locations.find((item) => item.id === actor?.place) || world.locations[0];
  }
  const event = notableEvent();
  const actor = world.actors.find((item) => item.id === event?.agent);
  return world.locations.find((item) => item.id === actor?.place) || world.locations[0];
}

function latestBeat() {
  const events = world.events || [];
  if (!events.length) return [];
  const tick = events[events.length - 1].tick;
  return events.filter((event) => event.tick === tick);
}

function notableEvent() {
  const beat = latestBeat();
  return beat.find((event) => event.ok && event.action === "speak")
    || beat.find((event) => event.ok && event.action === "move")
    || beat.find((event) => !event.ok)
    || beat[beat.length - 1]
    || null;
}

function beatByActor() {
  const marks = new Map();
  for (const event of latestBeat()) marks.set(event.agent, event);
  return marks;
}

function spokenLine(event) {
  const name = personName(event.agent);
  let text = (event.text || "").trim();
  if (name && text.startsWith(name)) text = text.slice(name.length);
  text = text.replace(/^对.{1,12}说[：:]/, "").replace(/^[说：:，,\s]+/, "");
  return (text.split(/[。！？]/)[0] || "").trim();
}

function glance(event, wide) {
  if (!event || event.action === "wait") return "";
  if (event.action === "speak") {
    if (!wide) return "说";
    const line = spokenLine(event);
    if (!line) return "开口了";
    if (line.length <= 24) return line;
    const cut = line.slice(0, 24);
    const pause = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("、"), cut.lastIndexOf("—"));
    return `${pause >= 6 ? cut.slice(0, pause) : cut}…`;
  }
  if (event.action === "move" && event.ok) {
    if (!wide) return "到了";
    const to = (event.text || "").match(/到了([^。]+)/);
    return to ? `到了${to[1]}` : "动身了";
  }
  if (event.ok) return "";
  if (!wide) return "受阻";
  let text = (event.text || "").trim();
  const name = personName(event.agent);
  if (name && text.startsWith(name)) text = text.slice(name.length);
  text = text.split(/[：:]/)[0].split(/[。！？]/)[0].trim();
  if (!text) return "没走成";
  return text.length > 16 ? `${text.slice(0, 16)}…` : text;
}

function fitMapStage() {
  const stage = document.querySelector("#map-stage");
  const surface = document.querySelector("#map");
  if (!stage || !surface) return;
  const boundW = showAtlas ? surface.clientWidth : surface.clientWidth / 2;
  const boundH = surface.clientHeight;
  if (!boundW || !boundH) return;
  const imageW = atlas.naturalWidth || 1248;
  const imageH = atlas.naturalHeight || 832;
  const scale = Math.min(boundW / imageW, boundH / imageH);
  const drawW = imageW * scale;
  const drawH = imageH * scale;
  const origin = showAtlas ? 0 : surface.clientWidth / 2;
  stage.style.width = `${drawW}px`;
  stage.style.height = `${drawH}px`;
  stage.style.left = `${origin + (boundW - drawW) / 2}px`;
  stage.style.top = `${(boundH - drawH) / 2}px`;
  stage.style.transform = "none";
}

function placePlate(plate, spot) {
  const scene = plate.parentElement;
  const viewW = scene.clientWidth;
  const viewH = scene.clientHeight;
  if (!viewW || !viewH) return;
  const imageW = atlas.naturalWidth || 1248;
  const imageH = atlas.naturalHeight || 832;
  const footLine = 0.86;
  const focusX = spot.feet[0] / 100;
  const focusY = Math.min(0.98, Math.max(0.02, spot.feet[1] / 100));
  const cover = Math.max(viewW / imageW, viewH / imageH);
  const above = (footLine * viewH) / (focusY * imageH);
  const below = ((1 - footLine) * viewH) / ((1 - focusY) * imageH);
  const scale = Math.min(cover * 2.1, Math.max(cover, above, below));
  const drawW = imageW * scale;
  const drawH = imageH * scale;
  let left = viewW * 0.5 - focusX * drawW;
  let top = viewH * footLine - focusY * drawH;
  left = Math.min(0, Math.max(viewW - drawW, left));
  top = Math.min(0, Math.max(viewH - drawH, top));
  plate.style.width = `${drawW}px`;
  plate.style.height = `${drawH}px`;
  plate.style.left = `${left}px`;
  plate.style.top = `${top}px`;
}

function renderBook() {
  const stage = document.querySelector("#map-stage");
  if (turning || !leafLeft || !leafRight) return;
  latest.hidden = true;
  sceneChoices.hidden = true;
  if (!world) {
    stage.hidden = true;
    leafLeft.hidden = true;
    leafRight.hidden = true;
    turnBack.hidden = true;
    turnNext.hidden = true;
    bookTab.hidden = true;
    return;
  }
  fitMapStage();
  stage.hidden = !showAtlas;
  leafLeft.hidden = showAtlas;
  leafRight.hidden = showAtlas;
  turnBack.hidden = showAtlas || cursor <= 0;
  turnNext.hidden = showAtlas;
  bookTab.hidden = false;
  bookTab.textContent = showAtlas ? "故事" : "地图";
  turnNext.setAttribute("aria-label", cursor >= endCursor(pages.length) ? "写下一拍" : "下一页");
  if (showAtlas) return;
  paintLeaf(leafLeft, pages[cursor], cursor, "left");
  paintLeaf(leafRight, pages[cursor], cursor, "right");
  renderSceneChoices(pages[cursor]);
}

function sceneFor(spread) {
  if (spread?.kind !== "spread") return spread;
  const placeId = sceneByTick.get(spread.tick) || spread.focus;
  return spread.scenes.find((scene) => scene.placeId === placeId) || spread.scenes[0];
}

function renderSceneChoices(spread) {
  sceneChoices.replaceChildren();
  if (spread?.kind !== "spread" || spread.scenes.length < 2 || showAtlas) return;
  sceneChoices.hidden = false;
  const current = sceneFor(spread);
  for (const scene of spread.scenes) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.scenePlace = scene.placeId;
    button.textContent = placeName(scene.placeId);
    button.setAttribute("aria-pressed", String(scene.placeId === current.placeId));
    button.addEventListener("click", () => {
      sceneByTick.set(spread.tick, scene.placeId);
      renderBook();
    });
    sceneChoices.append(button);
  }
}

function paintLeaf(leaf, spread, index, side = "left") {
  leaf.replaceChildren();
  leaf.dataset.spread = String(index);
  leaf.dataset.tick = spread?.tick == null ? "" : String(spread.tick);
  const content = document.createElement("div");
  content.className = `spread-content spread-${side}`;
  leaf.append(content);
  const page = sceneFor(spread);
  if (!page || page.kind === "title") paintTitle(content);
  else paintScene(content, page, side);
  if (index <= 0) return;
  const folio = document.createElement("p");
  folio.className = `folio folio-${side}`;
  folio.textContent = `${index} / ${Math.max(1, pages.length - 1)}`;
  leaf.append(folio);
}

function paintTitle(leaf) {
  const plate = document.createElement("div");
  plate.className = "title-plate";
  if (world.plate) plate.style.backgroundImage = `url("${world.plate}")`;
  const shade = document.createElement("div");
  shade.className = "title-shade";
  const copy = document.createElement("div");
  copy.className = "title-copy";
  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = "故事";
  const title = document.createElement("h2");
  title.textContent = world.name || "还没有名字";
  const origin = document.createElement("p");
  origin.textContent = world.origin || "";
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "向右翻，看已经发生的事。翻到最后再翻一次，才写下一拍。";
  copy.append(kicker, title, origin, hint);
  leaf.append(plate, shade, copy);
}

function paintScene(leaf, page, side) {
  const location = world.locations.find((item) => item.id === page.placeId);
  const plate = document.createElement("div");
  plate.className = "scene-plate";
  const kicker = document.createElement("p");
  kicker.className = "scene-kicker";
  const from = (page.tickFrom ?? page.tick) + 1;
  const to = (page.tickTo ?? page.tick) + 1;
  const when = from === to ? `第 ${from} 拍` : `第 ${from}–${to} 拍`;
  kicker.textContent = `${location?.name || "某处"} · ${when}`;
  const cast = document.createElement("div");
  cast.className = "scene-cast";
  const snapshots = new Map((page.actorSnapshots || []).map((actor) => [actor.id, actor]));
  const present = page.present
    .map((id) => snapshots.get(id) || actorById(id))
    .filter(Boolean);
  present.forEach((actor, slot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scene-person";
    const center = 11 + (slot + 0.5) * 78 / Math.max(1, present.length);
    if ((side === "left" && center >= 50) || (side === "right" && center < 50)) button.tabIndex = -1;
    const line = page.lines.find((item) => item.actorId === actor.id);
    const event = line ? world.events[line.eventIndex] : null;
    const text = glance(event, true);
    if (text) button.classList.add(event.action === "speak" ? "hot" : "moved");
    const span = 78 / Math.max(1, present.length);
    button.style.width = `${span * 0.92}%`;
    button.style.left = `${11 + (slot + 0.5) * span}%`;
    if (text) {
      const bubble = document.createElement("span");
      bubble.className = `bubble ${event.ok ? event.action : "failed"}`;
      bubble.textContent = text;
      button.append(bubble);
    }
    if (actor.image) {
      const image = document.createElement("img");
      image.alt = actor.name;
      image.src = actor.image;
      button.append(image);
    } else {
      const token = document.createElement("span");
      token.className = "token";
      token.textContent = actor.name.slice(0, 1);
      button.append(token);
    }
    button.addEventListener("click", () => openActor(actor.id));
    cast.append(button);
  });
  leaf.append(plate, kicker, cast);
  if (!page.lines.length) {
    const note = document.createElement("p");
    note.className = "scene-note";
    note.textContent = "这一拍，谁都停在原地。";
    leaf.append(note);
  }
  if (!world.plate || !location) return;
  const index = world.locations.findIndex((item) => item.id === location.id);
  plate.style.backgroundImage = `url("${world.plate}")`;
  placePlate(plate, anchorFor(location, index, world.locations.length));
}

function item(text) {
  const row = document.createElement("li");
  row.textContent = text;
  return row;
}

function shut(location) {
  return Boolean(location.access?.sealed) || closedAfter(location);
}

function accessText(location) {
  if (location.access?.sealed) return "关着";
  if (location.access?.closed_after != null) {
    return closedAfter(location) ? "已关闭" : `第 ${Number(location.access.closed_after) + 1} 拍起关闭`;
  }
  return "可以进入";
}

function closedAfter(location) {
  const threshold = Number(location.access?.closed_after);
  return Number.isFinite(threshold) && Number(world?.tick ?? 0) >= threshold;
}

function personName(id) {
  return actorById(id)?.name || "";
}

function actorById(id) {
  const latestEvent = [...(world?.events || [])].reverse().find((event) => event.agent === id && event.actor);
  return world?.actors?.find((actor) => actor.id === id)
    || world?.archivedActors?.find((actor) => actor.id === id)
    || latestEvent?.actor
    || null;
}

function placeName(id) {
  return world.locations.find((location) => location.id === id)?.name || "";
}

function showPending(text) {
  pendingText = text;
  const waiting = text.startsWith("角色正在决定");
  const kicker = document.querySelector("#tick-kicker");
  if (kicker && waiting) kicker.textContent = "决定中";
  if (!waiting) {
    mind.hidden = false;
    mind.textContent = text;
  }
}

function syncPlayback(ready = world && world.actors.length > 0) {
  playing = Boolean(world?.simulation?.running);
  playButton.classList.toggle("is-on", playing);
  playButton.textContent = playing ? "播放中" : world?.simulation?.waiting ? "重试并运行" : "自动播放";
  playButton.disabled = busy || playing || !ready;
  playButton.setAttribute("aria-pressed", playing ? "true" : "false");
  stopButton.disabled = busy || !playing;
  const kicker = document.querySelector("#tick-kicker");
  if (kicker) kicker.textContent = ticking ? "决定中" : world?.simulation?.waiting ? "等待恢复" : "Tick";
}

function renderSimulationStatus() {
  if (!simulationStatus) return;
  const simulation = world?.simulation || {};
  const mode = world?.mode || simulation.mode || world?.model?.mode || (world ? (world.model?.used ? "model" : "rules") : "");
  const parts = [];
  if (mode === "model") parts.push("模型决策模式");
  else if (mode === "rules") parts.push("规则演示模式");
  if (world) parts.push(simulation.running ? `服务端运行中 · 每 ${Number(simulation.interval || 1).toFixed(1)} 秒一拍` : "自动模拟已停止");
  if (ticking) parts.push("角色正在决定");
  else if (simulation.waiting) parts.push("等待恢复，可重试运行或手动推进");
  if (simulation.error) parts.push(`模拟错误：${simulation.error}`);
  if (configurationNotice) parts.push(configurationNotice);
  if (connectionNotice) parts.push(connectionNotice);
  if (actionNotice) parts.push(actionNotice);
  simulationStatus.textContent = parts.join("　·　");
  simulationStatus.hidden = parts.length === 0;
  simulationStatus.classList.toggle("error", Boolean(simulation.error || configurationNotice || connectionNotice || actionNotice));
}

async function play() {
  if (busy || playing || !world || world.actors.length === 0) return;
  setBusy(true);
  try {
    const snapshot = await requestJson("/api/world/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ running: true, interval: 1.2 }),
    });
    actionNotice = "";
    showWorld(snapshot, { animate: false });
  } catch (error) {
    actionNotice = `无法启动自动模拟：${error.message}`;
    renderSimulationStatus();
  } finally {
    setBusy(false);
  }
}

async function stopPlay() {
  if (busy || !world || !playing) return;
  setBusy(true);
  try {
    const snapshot = await requestJson("/api/world/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ running: false, interval: world.simulation?.interval || 1.2 }),
    });
    actionNotice = "";
    showWorld(snapshot, { animate: false });
  } catch (error) {
    actionNotice = `无法停止自动模拟：${error.message}`;
    renderSimulationStatus();
  } finally {
    setBusy(false);
  }
}

function delay(ms) {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

async function flip(step) {
  if (turning || ticking || busy || !world) return;
  if (showAtlas) {
    if (step > 0) setView("story");
    return;
  }
  if (step > 0 && cursor >= endCursor(pages.length)) {
    await stepOnce();
    return;
  }
  await slide(step);
}

async function slide(step) {
  const limit = endCursor(pages.length);
  const next = cursor + step;
  if (next < 0 || next > limit) return false;
  await animateTurn(step, next);
  return true;
}

async function animateTurn(step, target) {
  if (turning) return;
  const limit = endCursor(pages.length);
  const landing = Math.max(0, Math.min(target, limit));
  const forward = step > 0;
  turning = true;
  sceneChoices.hidden = true;
  try {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const source = forward ? leafRight : leafLeft;
    if (!reduced && source.childNodes.length) {
      curl.className = `curl ${forward ? "forward" : "back"}`;
      curl.hidden = false;
      curlFront.replaceChildren(...[...source.childNodes].map((node) => node.cloneNode(true)));
      const backIndex = landing;
      paintLeaf(curlBack, pages[backIndex], backIndex, forward ? "left" : "right");
      if (forward) paintLeaf(leafRight, pages[landing], landing, "right");
      else paintLeaf(leafLeft, pages[landing], landing, "left");
      await delay(640);
    }
    cursor = landing;
    pinnedToEnd = cursor >= limit;
  } finally {
    turning = false;
    curl.hidden = true;
    curl.className = "curl";
    curlFront.replaceChildren();
    curlBack.replaceChildren();
  }
  renderBook();
}

async function curlTo(target, force = false) {
  const limit = endCursor(pages.length);
  const landing = Math.max(0, Math.min(target, limit));
  if (cursor === landing && !force) {
    pinnedToEnd = true;
    renderBook();
    return;
  }
  await animateTurn(landing >= cursor ? 1 : -1, landing);
}

function setBusy(nextBusy) {
  busy = Boolean(nextBusy);
  const ready = Boolean(world?.actors?.length);
  nextButton.disabled = busy || ticking || playing || !ready;
  playButton.disabled = busy || playing || !ready;
  stopButton.disabled = busy || !playing;
  addButton.disabled = busy || !world;
  agentName.disabled = busy || !world;
  removeButton.disabled = busy || selected?.type !== "actor" || !world?.actors?.some((actor) => actor.id === selected.id);
  idea.disabled = busy;
  composer.querySelector("button[type='submit']").disabled = busy;
  useModel.disabled = busy || !modelConfigured;
  simulationStatus?.classList.toggle("busy", busy);
  syncPlayback(ready);
  renderSimulationStatus();
}

window.addEventListener("resize", () => {
  if (world) renderBook();
});
atlas.addEventListener("load", () => {
  if (!world?.plate) return;
  renderBook();
});
