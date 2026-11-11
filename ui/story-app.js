import { createRedHeadedWorld } from '../spatial/red-headed-world.js';
import { createStoryScene } from '../rendering/story-scene.js';
import { createTransport } from './transport.js';

const $ = (id) => document.getElementById(id);
const ui = {
  place: $('place-select'), chapter: $('chapter-select'), overview: $('overview-button'),
  cutaway: $('cutaway-button'), walking: $('walking-button'), host: $('scene-host'),
  loading: $('scene-loading'), sceneError: $('scene-error'), sceneErrorText: $('scene-error-text'),
  sceneRetry: $('scene-retry'), hint: $('scene-hint'), thread: $('chat-thread'), status: $('chat-status'),
  error: $('chat-error'), errorText: $('chat-error-text'), retry: $('chat-retry'),
  form: $('chat-form'), input: $('message-input'), send: $('send-button'), cancel: $('cancel-button'),
};
const transport = createTransport({ fetch, EventSource: null, TextDecoder });
const fallbackChapters = [
  { id: 'league', name: '红发会', time: '10:00' },
  { id: 'investigation', name: '调查', time: '14:00' },
  { id: 'heist', name: '银行之夜', time: '23:00' },
  { id: 'aftermath', name: '破案之后', time: '00:30' },
];
const fallbackWelcome = '想先去哪里？也可以问我故事里的细节。';

let world = null;
let scene = null;
let currentChapter = 'investigation';
let currentPlace = '';
let messages = [];
let modelConfigured = null;
let remoteBusy = false;
let localTask = null;
let cancelInFlight = false;
let progressPreview = '';
let progressStatus = '';
let retryText = '';
let pollTimer = null;
let sceneObserver = null;
let disposed = false;
let sceneLoading = false;
let webglMissing = false;

function safeText(value) {
  return typeof value === 'string' ? value : '';
}

function validPlace(id) {
  return world?.places?.some((place) => place.id === id) ? id : '';
}

function setChapter(id) {
  if (!world?.chapters?.some((chapter) => chapter.id === id)) return;
  currentChapter = id;
  ui.chapter.value = id;
  scene?.setChapter(id);
}

function setPlace(id, { focus = true } = {}) {
  const placeId = validPlace(id);
  if (!placeId) return;
  currentPlace = placeId;
  ui.place.value = placeId;
  if (focus) scene?.focus(placeId);
}

function locationId(value) {
  if (typeof value === 'string') return validPlace(value);
  if (value && typeof value === 'object') {
    return validPlace(value.placeId) || validPlace(value.id) || '';
  }
  return '';
}

function selectedPlace() {
  return currentPlace || locationId(scene?.getLocation?.()) || undefined;
}

function dataFlag(value) {
  return ['true', '1', 'on'].includes(String(value ?? '').toLowerCase());
}

function syncSceneModes(walkingOverride) {
  const walking = typeof walkingOverride === 'boolean' ? walkingOverride : dataFlag(ui.host.dataset.walking);
  const cutaway = dataFlag(ui.host.dataset.cutaway);
  ui.walking.setAttribute('aria-pressed', String(walking));
  ui.cutaway.setAttribute('aria-pressed', String(cutaway));
  ui.hint.dataset.walking = String(walking);
  ui.hint.textContent = walking
    ? '拖动视角 · WASD / 方向键行走 · Escape 退出'
    : '拖动旋转 · 滚轮缩放';
}

function observeSceneModes() {
  syncSceneModes();
  if (typeof MutationObserver !== 'function') return;
  sceneObserver = new MutationObserver(() => syncSceneModes());
  sceneObserver.observe(ui.host, { attributes: true, attributeFilter: ['data-walking', 'data-cutaway'] });
}

function populateWorldControls() {
  const places = Array.isArray(world?.places) ? world.places : [];
  for (const place of places) {
    const option = document.createElement('option');
    option.value = place.id;
    option.textContent = place.name;
    ui.place.append(option);
  }

  const chapters = Array.isArray(world?.chapters) && world.chapters.length ? world.chapters : fallbackChapters;
  ui.chapter.replaceChildren();
  for (const chapter of chapters) {
    const option = document.createElement('option');
    option.value = chapter.id;
    option.textContent = chapter.time ? `${chapter.name} · ${chapter.time}` : chapter.name;
    ui.chapter.append(option);
  }
  if (!chapters.some((chapter) => chapter.id === currentChapter)) currentChapter = chapters[0]?.id || 'investigation';
  setChapter(currentChapter);
}

function normalizedMessages(value) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .map((message) => ({ role: message.role, content: message.content }));
}

function messageNode(role, content, pending = false) {
  const article = document.createElement('article');
  article.className = `message ${role}`;
  article.dataset.role = role;
  const label = document.createElement('span');
  label.className = 'message-role';
  label.textContent = role === 'user' ? '你' : '红发会';
  const paragraph = document.createElement('p');
  paragraph.className = 'message-copy';
  paragraph.textContent = content;
  article.append(label, paragraph);
  updateMessageNode(article, content, pending);
  return article;
}

function updateMessageNode(article, content, pending = false) {
  article.classList.toggle('pending', pending);
  if (pending) article.setAttribute('aria-live', 'off');
  else article.removeAttribute('aria-live');
  const paragraph = article.querySelector('.message-copy');
  if (paragraph.textContent !== content) paragraph.textContent = content;
}

function renderThread(forceScroll = false) {
  const shouldScroll = forceScroll || ui.thread.scrollHeight - ui.thread.scrollTop - ui.thread.clientHeight < 56;
  const entries = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    entries.push({ role: message.role, content: message.content, pending: false });
  }
  if (localTask) {
    entries.push({ role: 'user', content: localTask.message, pending: false });
    if (progressPreview) {
      entries.push({ role: 'assistant', content: progressPreview, pending: true });
    }
  }

  if (!entries.length) {
    let welcome = ui.thread.children[0];
    if (!welcome?.classList.contains('welcome')) {
      welcome = document.createElement('p');
      welcome.className = 'welcome';
      ui.thread.insertBefore(welcome, ui.thread.children[0] || null);
    }
    if (welcome.textContent !== fallbackWelcome) welcome.textContent = fallbackWelcome;
  } else {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      let article = ui.thread.children[index];
      if (!article?.classList.contains('message') || article.dataset.role !== entry.role) {
        article = messageNode(entry.role, entry.content, entry.pending);
      } else {
        updateMessageNode(article, entry.content, entry.pending);
      }
      const current = ui.thread.children[index];
      if (current !== article) ui.thread.insertBefore(article, current || null);
    }
  }

  const wantedCount = entries.length || 1;
  while (ui.thread.children.length > wantedCount) ui.thread.lastElementChild.remove();
  if (shouldScroll) ui.thread.scrollTop = ui.thread.scrollHeight;
}

function isBusy() {
  return Boolean(localTask || remoteBusy || cancelInFlight);
}

function updateControls() {
  const busy = isBusy();
  const hasInput = Boolean(ui.input.value.trim());
  ui.input.disabled = busy;
  ui.send.disabled = busy || !hasInput;
  ui.cancel.hidden = !busy;
  ui.cancel.disabled = cancelInFlight;
  ui.cancel.textContent = cancelInFlight ? '正在停止…' : '停止';
  ui.form.setAttribute('aria-busy', String(busy));
  ui.status.textContent = busy ? (progressStatus || '正在回复…') : '';
  ui.overview.disabled = !scene;
  ui.cutaway.disabled = !scene;
  ui.walking.disabled = !scene;
}

function showChatError(message, retry) {
  ui.errorText.textContent = message;
  ui.error.hidden = false;
  ui.retry.hidden = !retry;
}

function hideChatError() {
  ui.error.hidden = true;
  ui.errorText.textContent = '';
}

function scheduleStatePoll() {
  if (disposed || !remoteBusy || localTask || pollTimer) return;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    await loadState();
  }, 2200);
}

async function loadState({ initial = false } = {}) {
  try {
    const response = await fetch('/api/story-state', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('state');
    const state = await response.json();
    const nextMessages = normalizedMessages(state.messages);
    if (nextMessages && !localTask) {
      messages = nextMessages;
      renderThread();
    }
    if (typeof state.model?.configured === 'boolean') modelConfigured = state.model.configured;
    if (typeof state.busy === 'boolean' && !localTask) remoteBusy = state.busy;
    if (initial && typeof state.chapter === 'string') setChapter(state.chapter);
    if (remoteBusy) scheduleStatePoll();
    else if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    updateControls();
    return true;
  } catch {
    if (initial) {
      remoteBusy = false;
      updateControls();
    } else if (remoteBusy) scheduleStatePoll();
    return false;
  }
}

function webglAvailable() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
  context?.getExtension('WEBGL_lose_context')?.loseContext();
  return Boolean(context);
}

function showSceneError(message) {
  sceneLoading = false;
  ui.loading.hidden = true;
  ui.sceneErrorText.textContent = message;
  ui.sceneError.hidden = false;
  scene = null;
  updateControls();
}

async function initializeScene() {
  if (disposed || sceneLoading) return;
  sceneLoading = true;
  webglMissing = !webglAvailable();
  ui.sceneError.hidden = true;
  ui.loading.hidden = false;
  ui.loading.textContent = '正在载入世界…';
  if (scene) {
    scene.dispose();
    scene = null;
  }
  if (webglMissing) {
    showSceneError('此浏览器无法启用 WebGL。');
    return;
  }
  try {
    const nextScene = await createStoryScene(ui.host, world, {
      chapter: currentChapter,
      onPlace: (placeId) => setPlace(placeId, { focus: false }),
    });
    if (disposed) {
      nextScene.dispose();
      return;
    }
    scene = nextScene;
    scene.setChapter(currentChapter);
    if (currentPlace) scene.focus(currentPlace);
    else scene.overview();
    syncSceneModes();
    sceneLoading = false;
    ui.loading.hidden = true;
    ui.sceneError.hidden = true;
    updateControls();
  } catch {
    showSceneError('三维场景暂时无法载入。');
  }
}

function applyResultActions(result) {
  if (typeof result.chapter === 'string') setChapter(result.chapter);
  if (typeof result.focus === 'string' && validPlace(result.focus)) setPlace(result.focus);
}

async function sendMessage(value = ui.input.value) {
  const message = safeText(value).trim();
  if (!message || isBusy() || disposed) return;
  hideChatError();
  retryText = '';
  progressPreview = '';
  progressStatus = '';
  let finishTask;
  const task = {
    message,
    controller: new AbortController(),
    cancelled: false,
    finished: new Promise((resolve) => { finishTask = resolve; }),
  };
  task.finish = finishTask;
  localTask = task;
  remoteBusy = false;
  updateControls();
  renderThread(true);

  try {
    const result = await transport.streamStep('/api/story-chat', {
      message,
      placeId: selectedPlace(),
      chapter: currentChapter,
    }, {
      signal: task.controller.signal,
      isCurrent: () => localTask === task && !disposed,
      onProgress: (progress) => {
        if (localTask !== task) return;
        if (typeof progress?.preview === 'string') progressPreview = progress.preview;
        progressStatus = safeText(progress?.message) || (
          progress?.phase === 'connecting' ? '正在连接…' : '正在整理故事…'
        );
        updateControls();
        renderThread();
      },
    });

    if (Array.isArray(result.messages)) messages = normalizedMessages(result.messages) || messages;
    if (task.cancelled || result.cancelled || result.canceled) return;
    if (result.ok) {
      if (!Array.isArray(result.messages)) {
        messages = [...messages, { role: 'user', content: message }];
        if (typeof result.message === 'string' && result.message) messages.push({ role: 'assistant', content: result.message });
      }
      applyResultActions(result);
      retryText = '';
      hideChatError();
      if (ui.input.value.trim() === message) ui.input.value = '';
    } else {
      retryText = message;
      showChatError(
        safeText(result.message).trim() || (modelConfigured === false
          ? '故事助手尚未配置；你仍可以去当铺继续浏览。'
          : '这次回复没有完成，输入已保留。'),
        true,
      );
    }
  } catch {
    if (!task.cancelled && !task.controller.signal.aborted) {
      retryText = message;
      showChatError(
        modelConfigured === false
          ? '故事助手尚未配置；你仍可以去当铺继续浏览。'
          : '这次回复没有完成，输入已保留。',
        true,
      );
    }
  } finally {
    if (localTask === task) localTask = null;
    progressPreview = '';
    progressStatus = '';
    updateControls();
    renderThread();
    task.finish();
  }
}

async function cancelMessage() {
  if ((!localTask && !remoteBusy) || cancelInFlight) return;
  const task = localTask;
  cancelInFlight = true;
  if (task) {
    task.cancelled = true;
    task.controller.abort();
  }
  updateControls();
  const cancelRequest = fetch('/api/story-cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null);
  if (task) await task.finished;
  await cancelRequest;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  const loaded = await loadState();
  cancelInFlight = false;
  if (!loaded && remoteBusy) scheduleStatePoll();
  updateControls();
}

ui.place.addEventListener('change', () => {
  const id = ui.place.value;
  if (!id) {
    currentPlace = '';
    scene?.overview();
  } else setPlace(id);
});
ui.chapter.addEventListener('change', () => setChapter(ui.chapter.value));
ui.overview.addEventListener('click', () => {
  currentPlace = '';
  ui.place.value = '';
  scene?.overview();
});
ui.cutaway.addEventListener('click', () => {
  if (!scene) return;
  const enabled = !dataFlag(ui.host.dataset.cutaway);
  scene.setCutaway(enabled);
  syncSceneModes();
});
ui.walking.addEventListener('click', () => {
  if (!scene) return;
  const enabled = !dataFlag(ui.host.dataset.walking);
  const actual = scene.setWalking(enabled);
  if (typeof actual === 'boolean') syncSceneModes(actual);
  else if (actual && typeof actual.then === 'function') {
    actual.then((value) => syncSceneModes(typeof value === 'boolean' ? value : undefined)).catch(() => syncSceneModes());
  } else syncSceneModes();
});
ui.sceneRetry.addEventListener('click', () => { void initializeScene(); });
ui.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void sendMessage();
});
ui.input.addEventListener('input', updateControls);
ui.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    ui.form.requestSubmit();
  }
});
ui.cancel.addEventListener('click', () => { void cancelMessage(); });
ui.retry.addEventListener('click', () => { if (retryText) void sendMessage(retryText); });

function boot() {
  try {
    observeSceneModes();
    world = createRedHeadedWorld();
    populateWorldControls();
    renderThread();
    void loadState({ initial: true });
    void initializeScene();
  } catch {
    ui.loading.hidden = true;
    showSceneError('红发会世界暂时无法载入。');
  }
}

window.addEventListener('pagehide', () => {
  disposed = true;
  if (pollTimer) clearTimeout(pollTimer);
  sceneObserver?.disconnect();
  sceneObserver = null;
  localTask?.controller.abort();
  scene?.dispose();
  transport.closeSubscription();
}, { once: true });

boot();
