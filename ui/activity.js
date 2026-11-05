const kinds = { origin: '起点', action: '行动', speech: '说话', environment: '环境', failure: '未完成' };
const list = (value) => Array.isArray(value) ? value : [];
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const text = (value) => typeof value === 'string' && value.trim() ? value : '';
const nearBottom = (element) => element.scrollHeight - element.scrollTop - element.clientHeight < 48;
function setText(element, value) {
  const next = String(value ?? '');
  if (element.textContent !== next) element.textContent = next;
}

// Own the bounded activity history, reused DOM nodes and reading position.
// Page event listeners delegate here without sharing their request state.
export function createActivityView({ scroll, log, empty, newButton, createNode: node, formatMinute: minute }) {
  let activityWorld = null, activityRevision = null, activities = new Map();
  const activityNodes = new Map();
  let following = true, unread = 0, pendingActivityScrollTop = null;

  function updateUnread() {
    newButton.hidden = following || unread === 0;
    setText(newButton, `${unread} 条新动态 · 回到底部`);
  }
  const changePattern = /^(.*?)(\d+)\s*(?:→|->)\s*(\d+)(.*)$/u;
  function renderActivityText(element, value) {
    const match = changePattern.exec(value || '');
    if (!match) { element.textContent = value || ''; return; }
    const [, label, before, after, tail] = match;
    if (!label.trim()) { element.textContent = value; return; }
    renderActivityChange(element, label, before, after, tail);
  }
  function renderActivityChange(element, label, before, after, tail) {
    const signature = `${label}|${before}|${after}|${tail}`;
    if (element.dataset.change === signature) return;
    element.dataset.change = signature;
    const line = node('span', '', 'activity-change');
    line.append(node('span', label.trim(), 'change-label'));
    const delta = Number(after) - Number(before);
    const chip = node('span', '', `change-chip ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : 'is-flat'}`);
    chip.append(node('b', before), node('span', '→', 'change-arrow'), node('b', after));
    line.append(chip);
    if (tail.trim()) line.append(node('span', tail.trim(), 'change-tail'));
    element.replaceChildren(line);
  }
  function isLegacyBaseEnvironmentEntry(entry) {
    return entry.kind === 'environment' && entry.revision === 0 && !entry.detail;
  }
  function render(next) {
    const key = next.instanceId || next.genesis?.instanceId || next.genesis?.draftId || next.world?.title;
    const reset = key !== activityWorld || finite(activityRevision) && finite(next.revision) && next.revision < activityRevision;
    if (reset) {
      activities.clear(); activityNodes.clear(); log.replaceChildren();
      following = true; unread = 0; pendingActivityScrollTop = null; activityWorld = key;
    }
    activityRevision = next.revision;
    const wasFollowing = following;
    const top = scroll.getBoundingClientRect().top;
    const anchor = !wasFollowing ? [...log.children].find((entry) => entry.getBoundingClientRect().bottom > top) : null;
    const anchorTop = anchor?.getBoundingClientRect().top;
    const previous = new Set(activities.keys());
    for (const entry of list(next.activity)) {
      if (!entry || typeof entry.id !== 'string' || !entry.id || !Object.hasOwn(kinds, entry.kind) || typeof entry.text !== 'string') continue;
      activities.set(entry.id, { id: entry.id, revision: finite(entry.revision) ? entry.revision : 0, minute: entry.minute, kind: entry.kind, text: entry.text, detail: text(entry.detail) });
    }
    const entries = [...activities.values()]
      .filter((entry) => !isLegacyBaseEnvironmentEntry(entry))
      .sort((a, b) => a.revision - b.revision).slice(-300);
    activities = new Map(entries.map((entry) => [entry.id, entry]));
    for (const [id, item] of activityNodes) if (!activities.has(id)) { item.remove(); activityNodes.delete(id); }
    entries.forEach((entry, index) => {
      let item = activityNodes.get(entry.id);
      if (!item) {
        item = node('li'); item.dataset.activityId = entry.id;
        const meta = node('div', '', 'activity-meta'); meta.append(node('time'), node('span'));
        item.append(meta, node('p', '', 'activity-text'), node('p', '', 'activity-detail'));
        activityNodes.set(entry.id, item);
      }
      item.className = `activity-${entry.kind}`;
      setText(item.children[0].children[0], minute(entry.minute));
      setText(item.children[0].children[1], kinds[entry.kind]);
      renderActivityText(item.children[1], entry.text);
      setText(item.children[2], entry.detail);
      item.children[2].hidden = !entry.detail;
      if (log.children[index] !== item) log.insertBefore(item, log.children[index] || null);
    });
    empty.hidden = entries.length > 0;
    if (wasFollowing) { scroll.scrollTop = scroll.scrollHeight; pendingActivityScrollTop = scroll.scrollTop; unread = 0; }
    else {
      if (anchor?.parentNode) scroll.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
      unread = Math.min(300, unread + entries.filter((entry) => !previous.has(entry.id)).length);
    }
    updateUnread();
  }

  function restoreScroll() {
    if (pendingActivityScrollTop === null) return;
    scroll.scrollTop = pendingActivityScrollTop;
    pendingActivityScrollTop = null;
  }
  function onScroll() {
    if (pendingActivityScrollTop !== null && scroll.scrollTop !== pendingActivityScrollTop) pendingActivityScrollTop = null;
    following = nearBottom(scroll);
    if (following) unread = 0;
    updateUnread();
  }
  function followLatest() {
    following = true; unread = 0;
    scroll.focus({ preventScroll: true });
    scroll.scrollTop = scroll.scrollHeight;
    pendingActivityScrollTop = scroll.scrollTop;
    updateUnread();
  }

  return { render, onScroll, followLatest, restoreScroll };
}
