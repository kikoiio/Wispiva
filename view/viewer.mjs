import { story } from "./world.mjs";
import { buildMap } from "./layout.mjs";
import { paintMap, paintSprite } from "./paint.mjs";
import { pathTiles } from "./walk.mjs";

const map = buildMap(story);
const picture = paintMap(map);
const zoom = 2;
const places = new Map(story.actors.map((actor) => [actor.id, actor.place]));
const shown = new Map();
const sprites = new Map();
let step = 0;
let walking = false;
let playing = false;
let selected = null;
let walkToken = 0;

const mapRoot = document.querySelector("#map");
const status = document.querySelector("#status");
const detail = document.querySelector("#detail");
const beatList = document.querySelector("#beats");
const nextButton = document.querySelector("#next");
const playButton = document.querySelector("#play");
const resetButton = document.querySelector("#reset");

const canvas = document.createElement("canvas");
canvas.width = picture.width;
canvas.height = picture.height;
const context = canvas.getContext("2d");
context.imageSmoothingEnabled = false;
const actorLayer = document.createElement("div");
actorLayer.className = "actors";
mapRoot.append(canvas, actorLayer);
applyZoom();
paintBase();

for (const actor of story.actors) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "actor";
  button.dataset.actor = actor.id;
  const sprite = document.createElement("canvas");
  const art = paintSprite(actor);
  sprite.width = art.width;
  sprite.height = art.height;
  sprite.getContext("2d").putImageData(new ImageData(art.data, art.width, art.height), 0, 0);
  button.append(sprite);
  button.addEventListener("click", () => select({ type: "actor", id: actor.id }));
  actorLayer.append(button);
  sprites.set(actor.id, button);
  const location = map.locations.find((item) => item.id === actor.place);
  shown.set(actor.id, { ...location.spawn });
  placeActor(actor.id, location.spawn);
}

canvas.addEventListener("click", (event) => {
  const bounds = canvas.getBoundingClientRect();
  const tileX = Math.floor((event.clientX - bounds.left) / (map.tileSize * zoom));
  const tileY = Math.floor((event.clientY - bounds.top) / (map.tileSize * zoom));
  const location = map.locations.find((item) => (
    tileX >= item.x && tileX < item.x + item.w && tileY >= item.y && tileY < item.y + item.h
  ));
  select(location ? { type: "location", id: location.id } : null);
});

nextButton.addEventListener("click", () => { void runBeat(); });
playButton.addEventListener("click", () => { playing ? stopPlay() : void play(); });
resetButton.addEventListener("click", reset);
renderBeats();
renderStatus();
renderDetail();

function paintBase() {
  context.putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
  if (selected?.type !== "location") return;
  const location = map.locations.find((item) => item.id === selected.id);
  context.strokeStyle = "#e2b657";
  context.lineWidth = 2;
  context.strokeRect(
    location.x * map.tileSize + 1,
    location.y * map.tileSize + 1,
    location.w * map.tileSize - 2,
    location.h * map.tileSize - 2,
  );
}

function applyZoom() {
  canvas.style.width = `${picture.width * zoom}px`;
  canvas.style.height = `${picture.height * zoom}px`;
  actorLayer.style.width = canvas.style.width;
  actorLayer.style.height = canvas.style.height;
}

function placeActor(actorId, tile) {
  const button = sprites.get(actorId);
  const art = paintSprite(story.actors.find((actor) => actor.id === actorId));
  button.style.left = `${(tile.x + 0.5) * map.tileSize * zoom}px`;
  button.style.top = `${(tile.y + 1) * map.tileSize * zoom}px`;
  button.style.width = `${art.width * zoom}px`;
  button.firstChild.style.width = `${art.width * zoom}px`;
  button.firstChild.style.height = `${art.height * zoom}px`;
  shown.set(actorId, { x: tile.x, y: tile.y });
  const marker = document.querySelector(`.marker[data-actor="${actorId}"]`);
  if (!marker) return;
  marker.style.left = `${(tile.x + 0.5) * map.tileSize * zoom}px`;
  marker.style.top = `${tile.y * map.tileSize * zoom - 8}px`;
}

async function runBeat() {
  if (walking) return;
  if (step >= story.beats.length) {
    status.textContent = "这段走完了。";
    return;
  }
  const beat = story.beats[step];
  const fromId = places.get(beat.actor);
  const path = pathTiles(map, fromId, beat.to);
  places.set(beat.actor, beat.to);
  step += 1;
  select({ type: "actor", id: beat.actor });
  showMarker(beat);
  renderBeats();
  walking = true;
  renderStatus(beat);
  renderDetail();
  setBusy(true);
  const token = walkToken;
  await walk(beat.actor, path, token);
  if (token !== walkToken) return;
  setBusy(false);
  renderStatus(beat);
}

async function walk(actorId, path, token) {
  walking = true;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || path.length < 2) {
    placeActor(actorId, path.at(-1));
    walking = false;
    return;
  }
  const duration = Math.min(2400, Math.max(480, (path.length - 1) * 140));
  const started = performance.now();
  await new Promise((resolve) => {
    function frame() {
      if (token !== walkToken) {
        resolve();
        return;
      }
      const progress = Math.min(1, (performance.now() - started) / duration);
      const distance = progress * (path.length - 1);
      const index = Math.min(path.length - 2, Math.floor(distance));
      const fraction = distance - index;
      const from = path[index];
      const to = path[index + 1];
      placeActor(actorId, {
        x: from.x + (to.x - from.x) * fraction,
        y: from.y + (to.y - from.y) * fraction,
      });
      if (progress < 1) window.setTimeout(frame, 32);
      else resolve();
    }
    window.setTimeout(frame, 32);
  });
  if (token === walkToken) walking = false;
}

function showMarker(beat) {
  document.querySelector(".marker")?.remove();
  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = "marker";
  marker.textContent = beat.text;
  marker.dataset.actor = beat.actor;
  const tile = shown.get(beat.actor);
  marker.style.left = `${(tile.x + 0.5) * map.tileSize * zoom}px`;
  marker.style.top = `${tile.y * map.tileSize * zoom - 8}px`;
  marker.addEventListener("click", () => select({ type: "actor", id: beat.actor }));
  actorLayer.append(marker);
}

async function play() {
  playing = true;
  playButton.textContent = "暂停";
  while (playing && step < story.beats.length) {
    await runBeat();
    if (!playing) break;
    await new Promise((resolve) => { window.setTimeout(resolve, 450); });
  }
  stopPlay();
}

function stopPlay() {
  playing = false;
  playButton.textContent = "连续播放";
}

function reset() {
  stopPlay();
  walkToken += 1;
  walking = false;
  step = 0;
  for (const actor of story.actors) {
    places.set(actor.id, actor.place);
    const location = map.locations.find((item) => item.id === actor.place);
    placeActor(actor.id, location.spawn);
  }
  document.querySelector(".marker")?.remove();
  select(null);
  setBusy(false);
  renderBeats();
  renderStatus();
}

function select(next) {
  selected = next;
  for (const [actorId, button] of sprites) {
    button.classList.toggle("selected", next?.type === "actor" && next.id === actorId);
  }
  paintBase();
  renderDetail();
}

function renderBeats() {
  beatList.replaceChildren();
  story.beats.forEach((beat, index) => {
    const item = document.createElement("li");
    if (index < step) item.classList.add("done");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = beat.text;
    button.addEventListener("click", () => select({ type: "actor", id: beat.actor }));
    item.append(button);
    beatList.append(item);
  });
}

function renderStatus(beat) {
  if (step === 0) {
    status.textContent = "还没出发。三个人都在原来的地方。";
    return;
  }
  const actor = story.actors.find((item) => item.id === beat.actor);
  const place = locationName(places.get(actor.id));
  const moving = walking ? "人还在路上。" : "人已经走到了。";
  status.textContent = `第 ${step} 拍，共 ${story.beats.length} 拍。${actor.name} 的记录已在${place}。${moving}`;
}

function renderDetail() {
  if (!selected) {
    detail.textContent = "点房间或人，查看记录里的位置。";
    return;
  }
  if (selected.type === "location") {
    const location = map.locations.find((item) => item.id === selected.id);
    const names = story.actors
      .filter((actor) => places.get(actor.id) === location.id)
      .map((actor) => actor.name);
    const who = names.length ? names.join("、") : "此刻没有人";
    detail.textContent = `${location.name}。按记录，${who}在这里。`;
    return;
  }
  const actor = story.actors.find((item) => item.id === selected.id);
  detail.textContent = `${actor.name}。按记录在${locationName(places.get(actor.id))}。`;
}

function locationName(id) {
  return map.locations.find((location) => location.id === id).name;
}

function setBusy(busy) {
  nextButton.disabled = busy || step >= story.beats.length;
  if (!playing) playButton.disabled = busy;
}
