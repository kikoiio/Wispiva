// Own renderer instances and mount generations. Page/request state stays with
// the caller; renderers only receive their latest scene snapshot.
export function createSceneSlots({
  hosts, createNode: node, onVoxelChange = () => {},
  loadScene = () => import('../rendering/scene.js'),
  loadVoxelScene = () => import('../rendering/voxel-scene.js'),
}) {
  const slots = Object.fromEntries(Object.entries(hosts).map(([name, host]) => [name, {
    name, host, key: null, kind: null, token: 0, scene: null,
    latest: null, signature: '', interior: false,
  }]));
  let suspended = false;
  const current = (slot, token) => !suspended && token === slot.token;
  const dispose = (scene) => { try { scene?.dispose(); } catch {} };
  const signature = (kind, next) => kind === 'voxel'
    ? JSON.stringify([next.revision, next.actors || []])
    : `${next.revision}:${next.worldMinute}:${next.paused}:${next.scene.revision ?? 0}:${next.world.environment?.weather ?? ''}`;
  const notifyVoxel = (slot, phase) => {
    if (slot.name === 'voxel') onVoxelChange(phase, slot.latest);
  };

  function release(slot) {
    if (slot.key === null && !slot.scene) return;
    slot.token++;
    dispose(slot.scene);
    slot.scene = null; slot.key = null; slot.kind = null;
    slot.signature = ''; slot.latest = null; slot.interior = false;
    slot.host.replaceChildren();
    notifyVoxel(slot, 'released');
  }
  function loading(kind) {
    const element = node('div', '', 'scene-loading');
    element.setAttribute('role', 'status');
    element.append(node('span', '', 'scene-loading-mark'), node('span', kind === 'voxel' ? '正在载入体素画面…' : '正在载入画面…'));
    return element;
  }
  function failure(slot, token, cause = null) {
    if (!current(slot, token)) return;
    dispose(slot.scene);
    slot.scene = null;
    const voxel = slot.kind === 'voxel';
    const error = node('div', '', 'scene-error');
    error.append(node('p', voxel ? '画面暂时无法显示，你仍可以继续对话。' : '场景暂时无法显示，可以继续查看文字。'));
    if (cause?.message) error.append(node('p', `载入原因：${cause.message}`, 'scene-error-detail'));
    const retry = node('button', voxel ? '重新载入画面' : '重新载入场景', 'button secondary');
    retry.type = 'button';
    retry.addEventListener('click', () => {
      if (!current(slot, token)) return;
      const { key, kind, latest } = slot;
      release(slot);
      if (latest) sync(slot, kind, key, latest);
    });
    error.append(retry);
    slot.host.replaceChildren(error);
    if (voxel) notifyVoxel(slot, 'failed');
  }
  function accepted(slot) {
    if (slot.kind !== 'voxel') return;
    slot.host.dataset.revision = String(slot.latest.revision);
    notifyVoxel(slot, 'ready');
  }
  async function mountCurrent(slot, mount, placeholder, token) {
    const kind = slot.kind;
    const module = await (kind === 'voxel' ? loadVoxelScene() : loadScene());
    if (!current(slot, token)) return;
    const scene = await (kind === 'voxel' ? module.createVoxelScene : module.createScene)(mount, slot.latest);
    if (!current(slot, token)) { dispose(scene); return; }
    if (kind === 'voxel') placeholder.remove();
    slot.scene = scene;
    scene.update(slot.latest);
    slot.signature = signature(kind, slot.latest);
    accepted(slot);
  }
  function sync(slot, kind, key, next) {
    if (suspended || kind === 'scene' && (!next.world || !next.scene?.document)) { release(slot); return; }
    const nextSignature = signature(kind, next);
    if (slot.key === key && slot.kind === kind) {
      slot.latest = next;
      if (slot.scene && slot.signature !== nextSignature) {
        try {
          slot.scene.update(next);
          slot.signature = nextSignature;
          accepted(slot);
        } catch (error) { failure(slot, slot.token, error); }
      }
      return;
    }
    release(slot);
    slot.key = key; slot.kind = kind; slot.latest = next;
    const token = ++slot.token;
    const mount = node('div', '', 'scene-mount'), placeholder = loading(kind);
    mount.append(placeholder);
    slot.host.replaceChildren(mount);
    if (kind === 'voxel') notifyVoxel(slot, 'loading');
    void mountCurrent(slot, mount, placeholder, token).catch(error => failure(slot, token, error));
  }

  return {
    syncScene(name, key, next) { sync(slots[name], 'scene', key, next); },
    syncVoxel(name, key, next) { sync(slots[name], 'voxel', key, next); },
    release(name) { release(slots[name]); },
    suspend() { suspended = true; Object.values(slots).forEach(release); },
    resume() { suspended = false; },
    get voxelReady() { return Boolean(slots.voxel.scene); },
    frameVoxel() { slots.voxel.scene?.frame?.(); },
    toggleVoxelInterior() {
      const slot = slots.voxel;
      if (!slot.scene) return false;
      slot.interior = !slot.interior;
      slot.scene.cutaway?.(slot.interior);
      return slot.interior;
    },
  };
}
