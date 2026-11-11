import * as THREE from '/vendor/three.module.js';
import { compileStoryChunks } from './story-mesh.js';
import { createStoryNavigation } from '../spatial/story-navigation.js';

const fallbackPalette = {
  brick: '#986352', stone: '#999388', cobble: '#777b78', wood: '#75543a',
  grass: '#6e7650', dirt: '#655346', roof: '#48515a', glass: '#92b1b7',
  iron: '#30383b', gold: '#cba256', plaster: '#d6c6a7', wallpaper: '#536952',
};

export async function createStoryScene(host, world, { chapter = 'investigation', onPlace = () => {} } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.08, 800);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  const canvas = renderer.domElement;
  canvas.className = 'story-canvas';
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '红发会三维世界。拖动转动视角，滚轮缩放；步行时用 W A S D 或方向键移动。');
  host.appendChild(canvas);
  const sky = new THREE.Color('#929fa5');
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 200, 600);
  const hemisphere = new THREE.HemisphereLight('#e3edf1', '#80735a', 2.4);
  scene.add(hemisphere);
  const indoorFill = new THREE.PointLight('#f1dfc5', 0, 30, 1.5);
  scene.add(indoorFill);
  const sun = new THREE.DirectionalLight('#ffdfb0', 2.6);
  sun.position.set(-45, 100, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -95; sun.shadow.camera.right = 95;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 240;
  sun.shadow.normalBias = 0.05; sun.shadow.bias = -0.00015;
  scene.add(sun, sun.target);
  const target = new THREE.Vector3(...world.overview.target);
  sun.target.position.copy(target);
  const meshes = new THREE.Group(); scene.add(meshes);
  const residents = new THREE.Group(); scene.add(residents);
  const materials = new Map(), textures = new Set(), geometries = new Set();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1); geometries.add(boxGeometry);
  const placeMap = new Map(world.places.map(place => [place.id, place]));
  const navigation = createStoryNavigation(world);
  const clipping = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2);
  const bottomClipping = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const lights = Array.from({ length: 4 }, () => {
    const light = new THREE.PointLight('#ffd28a', 0, 12, 2); scene.add(light); return light;
  });
  const lampProps = world.props.filter(prop => prop.kind === 'lamp');
  const actorNodes = new Map();
  let disposed = false, scheduled = 0, walking = false, cutaway = false, autoCutaway = false;
  let activePlace = 'coburg-square', currentChapter = chapter;
  let azimuth = 0, polar = 0.8, radius = 80, yaw = 0, pitch = 0;
  let feet = [0, 0, 0], lastTime = 0, transition = null;
  let viewportWidth = 0, viewportHeight = 0;
  const pressed = new Set(), pointers = new Map();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const initialVector = new THREE.Vector3(...world.overview.position).sub(target);
  radius = initialVector.length(); polar = Math.acos(initialVector.y / radius); azimuth = Math.atan2(initialVector.x, initialVector.z);

  function textureFor(name, descriptor) {
    const tile = document.createElement('canvas'); tile.width = tile.height = 64;
    const ctx = tile.getContext('2d');
    ctx.fillStyle = '#ddd6c5'; ctx.fillRect(0, 0, 64, 64);
    let seed = [...name].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), 2166136261);
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const pattern = descriptor.pattern || name;
    if (/brick/.test(pattern)) {
      ctx.fillStyle = '#f4ead8'; ctx.fillRect(0, 0, 64, 64);
      for (let row = 0; row < 4; row++) for (let column = -1; column < 3; column++) {
        const x = column * 32 + (row % 2) * 16;
        const shade = 178 + Math.floor(random() * 60);
        ctx.fillStyle = `rgb(${shade},${shade - 6},${shade - 13})`;
        ctx.fillRect(x + 1, row * 16 + 1, 30, 14);
        ctx.fillStyle = '#ffffff24'; ctx.fillRect(x + 2, row * 16 + 2, 28, 1);
      }
    } else if (/wood|parquet/.test(pattern)) {
      ctx.fillStyle = '#dad0b7'; ctx.fillRect(0, 0, 64, 64);
      for (let column = 0; column < 4; column++) {
        ctx.fillStyle = '#51463350'; ctx.fillRect(column * 16, 0, 1, 64);
        ctx.fillRect(column * 16, column % 2 ? 20 : 45, 16, 1);
        for (let line = 0; line < 10; line++) {
          ctx.fillStyle = random() > 0.5 ? '#66533b16' : '#ffffff27';
          ctx.fillRect(column * 16 + 2 + random() * 12, random() * 64, 1, 10 + random() * 25);
        }
      }
    } else if (/wallpaper/.test(pattern)) {
      ctx.fillStyle = '#d8dcc3'; ctx.fillRect(0, 0, 64, 64);
      for (let x = 0; x < 64; x += 16) for (let y = 0; y < 64; y += 16) {
        ctx.fillStyle = '#78876a'; ctx.beginPath();
        ctx.moveTo(x + 8, y + 2); ctx.lineTo(x + 12, y + 8); ctx.lineTo(x + 8, y + 14); ctx.lineTo(x + 4, y + 8); ctx.fill();
        ctx.fillStyle = '#f3ecc1'; ctx.fillRect(x + 7, y + 7, 2, 2);
      }
    } else if (/rug/.test(pattern)) {
      ctx.fillStyle = '#d8c3a0'; ctx.fillRect(0, 0, 64, 64);
      for (let x = 0; x < 64; x += 16) for (let y = 0; y < 64; y += 16) {
        ctx.fillStyle = '#77704b'; ctx.fillRect(x + 5, y + 3, 6, 10);
        ctx.fillRect(x + 3, y + 5, 10, 6);
        ctx.fillStyle = '#f8e8be'; ctx.fillRect(x + 7, y + 7, 2, 2);
      }
    } else if (/roof|slate/.test(pattern)) {
      ctx.fillStyle = '#c0c4c5'; ctx.fillRect(0, 0, 64, 64);
      for (let row = 0; row < 4; row++) {
        ctx.fillStyle = '#535a6370'; ctx.fillRect(0, row * 16, 64, 2);
        for (let column = 0; column < 4; column++) ctx.fillRect(column * 16 + (row % 2) * 8, row * 16, 1, 16);
      }
    } else if (/glass/.test(pattern)) {
      ctx.fillStyle = '#e8f7fc'; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(8, 8, 3, 34); ctx.fillRect(11, 8, 20, 3);
    } else if (/stone|cobble/.test(pattern)) {
      ctx.fillStyle = '#9b9b92'; ctx.fillRect(0, 0, 64, 64);
      for (let row = 0; row < 4; row++) for (let column = -1; column < 5; column++) {
        const shade = 173 + random() * 65;
        ctx.fillStyle = `rgb(${shade},${shade},${shade - 5})`;
        ctx.fillRect(column * 16 + (row % 2) * 8 + 1, row * 16 + 1, 14, 14);
      }
    } else {
      ctx.fillStyle = '#e4dfd4'; ctx.fillRect(0, 0, 64, 64);
    }
    for (let i = 0; i < 180; i++) {
      ctx.fillStyle = i % 2 ? '#5c504314' : '#ffffff30';
      ctx.fillRect(Math.floor(random() * 64), Math.floor(random() * 64), 1 + Math.floor(random() * 3), 1);
    }
    const texture = new THREE.CanvasTexture(tile);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestMipmapLinearFilter;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.add(texture); return texture;
  }
  function materialFor(name) {
    if (materials.has(name)) return materials.get(name);
    const isLamp = name.startsWith('lamp:');
    const descriptor = world.materials?.[isLamp ? name.slice(5) : name] || {};
    const transparent = descriptor.transparent || /glass|water/.test(name);
    const metal = descriptor.pattern === 'metal' || /metal|iron|gold|brass|copper/.test(name);
    const material = new THREE.MeshStandardMaterial({
      color: descriptor.color || fallbackPalette[name] || '#8e8170',
      map: textureFor(name, descriptor), roughness: metal ? 0.45 : 0.87,
      metalness: /gold/.test(name) ? 0.5 : metal ? 0.25 : 0,
      transparent: Boolean(transparent), opacity: transparent ? 0.32 : 1, depthWrite: !transparent,
      emissive: isLamp ? '#ffc776' : descriptor.emissive || '#000000', emissiveIntensity: isLamp ? 1.1 : 0.8,
      clipShadows: true,
    });
    materials.set(name, material); return material;
  }
  function makeBox(parent, position, size, material) {
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.position.set(...position); mesh.scale.set(...size);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function sign(prop) {
    const label = document.createElement('canvas');
    label.width = 1024; label.height = Math.max(96, Math.min(512, Math.round(1024 * prop.size[1] / prop.size[0])));
    const ctx = label.getContext('2d');
    const descriptor = world.materials?.[prop.material] || {};
    ctx.fillStyle = descriptor.color || '#26372e'; ctx.fillRect(0, 0, label.width, label.height);
    ctx.strokeStyle = '#d4ba84'; ctx.lineWidth = 4; ctx.strokeRect(9, 9, label.width - 18, label.height - 18);
    const background = new THREE.Color(descriptor.color || '#26372e');
    ctx.fillStyle = background.r * 0.2126 + background.g * 0.7152 + background.b * 0.0722 > 0.4 ? '#302b23' : '#f1dfb6';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = (prop.text || '').split('\n');
    let fontSize = Math.min(76, label.height * 0.65 / lines.length);
    ctx.font = `600 ${fontSize}px "Noto Serif CJK SC", "Songti SC", serif`;
    const longest = Math.max(...lines.map(line => ctx.measureText(line).width), 1);
    if (longest > label.width - 48) fontSize *= (label.width - 48) / longest;
    ctx.font = `600 ${fontSize}px "Noto Serif CJK SC", "Songti SC", serif`;
    lines.forEach((line, index) => ctx.fillText(line, label.width / 2, label.height * (index + 0.5) / lines.length));
    const texture = new THREE.CanvasTexture(label); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, clipShadows: true });
    materials.set(`sign:${prop.id}`, material);
    const geometry = new THREE.PlaneGeometry(prop.size[0], prop.size[1]); geometries.add(geometry);
    const group = new THREE.Group(); group.position.set(...prop.position); group.rotation.y = prop.rotation || 0;
    const face = new THREE.Mesh(geometry, material); face.position.z = (prop.size[2] || 0.05) / 2 + 0.006;
    const reverse = face.clone(); reverse.position.z = -face.position.z; reverse.rotation.y = Math.PI;
    makeBox(group, [0, 0, 0], [prop.size[0], prop.size[1], prop.size[2] || 0.06], materialFor(prop.material));
    group.add(face, reverse); group.userData.site = prop.site; group.userData.layer = prop.layer;
    group.userData.chapters = prop.chapters;
    meshes.add(group);
  }
  const transparentMaterials = new Set(Object.entries(world.materials || {}).filter(([name, descriptor]) => descriptor.transparent || /glass|water/.test(name)).map(([name]) => name));
  for (const chunk of compileStoryChunks(world.cells, world.unit, { transparentMaterials })) {
    for (const data of chunk.geometries) {
      const geometry = new THREE.BufferGeometry(); geometries.add(geometry);
      geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(data.indices, 1)); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, materialFor(data.material));
      mesh.castShadow = !transparentMaterials.has(data.material); mesh.receiveShadow = true;
      mesh.userData.site = chunk.site; mesh.userData.layer = chunk.layer;
      meshes.add(mesh);
    }
  }
  const batches = new Map();
  for (const prop of world.props) {
    if (prop.kind === 'sign') { sign(prop); continue; }
    const id = `${prop.site}:${prop.layer}:${prop.kind}:${prop.material}:${prop.chapters?.join(',') || ''}`;
    if (!batches.has(id)) batches.set(id, []);
    batches.get(id).push(prop);
  }
  const transform = new THREE.Object3D();
  for (const props of batches.values()) {
    const mesh = new THREE.InstancedMesh(boxGeometry, materialFor(`${props[0].kind === 'lamp' ? 'lamp:' : ''}${props[0].material}`), props.length);
    props.forEach((prop, index) => {
      transform.position.set(...prop.position); transform.rotation.set(0, prop.rotation || 0, 0); transform.scale.set(...prop.size);
      transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.site = props[0].site; mesh.userData.layer = props[0].layer; meshes.add(mesh);
    mesh.userData.chapters = props[0].chapters;
  }
  function plainMaterial(color, key) {
    if (materials.has(key)) return materials.get(key);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 }); materials.set(key, material); return material;
  }
  for (const resident of world.residents) {
    const group = new THREE.Group();
    const coat = plainMaterial(resident.coat || '#343b3d', `coat:${resident.id}`);
    const skin = plainMaterial('#d2ac8a', 'skin');
    const hair = plainMaterial(resident.hair || '#41352b', `hair:${resident.id}`);
    const shoes = plainMaterial('#292b29', 'shoes');
    makeBox(group, [-0.12, 0.31, 0], [0.18, 0.62, 0.24], shoes);
    makeBox(group, [0.12, 0.31, 0], [0.18, 0.62, 0.24], shoes);
    makeBox(group, [0, 0.96, 0], [0.46, 0.72, 0.28], coat);
    makeBox(group, [-0.31, 0.91, 0], [0.13, 0.63, 0.22], coat);
    makeBox(group, [0.31, 0.91, 0], [0.13, 0.63, 0.22], coat);
    makeBox(group, [0, 1.46, 0], [0.31, 0.34, 0.31], skin);
    makeBox(group, [0, 1.62, 0.01], [0.34, 0.1, 0.33], hair);
    const eye = plainMaterial('#363332', 'eyes');
    makeBox(group, [-0.075, 1.48, 0.16], [0.035, 0.035, 0.02], eye);
    makeBox(group, [0.075, 1.48, 0.16], [0.035, 0.035, 0.02], eye);
    if (resident.id === 'sherlock-holmes') {
      makeBox(group, [0, 1.73, 0], [0.39, 0.13, 0.38], coat);
      makeBox(group, [0, 1.67, 0.07], [0.45, 0.055, 0.5], coat);
    }
    const label = document.createElement('canvas'); label.width = 512; label.height = 80;
    const ctx = label.getContext('2d'); ctx.font = '32px "Noto Sans CJK SC", sans-serif';
    ctx.textAlign = 'center'; ctx.fillStyle = '#efeadf'; ctx.shadowColor = '#202625'; ctx.shadowBlur = 6;
    ctx.fillText(resident.name, 256, 48);
    const texture = new THREE.CanvasTexture(label); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
    const labelMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: true }); materials.set(`actor-label:${resident.id}`, labelMaterial);
    const name = new THREE.Sprite(labelMaterial); name.position.y = 2.03; name.scale.set(3.2, 0.5, 1); group.add(name);
    group.userData.label = name; group.userData.resident = resident;
    residents.add(group); actorNodes.set(resident.id, group);
  }
  function requestRender() {
    if (!disposed && !scheduled) scheduled = requestAnimationFrame(render);
  }
  function applyClipping() {
    const place = placeMap.get(activePlace);
    const enabled = !walking && (cutaway || autoCutaway);
    clipping.constant = place?.interior ? (place.clipHeight ?? place.position[1] + 1.75) : 1.8;
    bottomClipping.constant = -(place?.position[1] - 0.5);
    renderer.clippingPlanes = enabled ? (place?.interior ? [clipping, bottomClipping] : [clipping]) : [];
    updateVisibility();
    host.dataset.cutaway = String(enabled);
    requestRender();
  }
  function focusSites() {
    const place = placeMap.get(activePlace);
    if (!place?.interior || walking || !(cutaway || autoCutaway)) return null;
    const sites = new Set([place.site]);
    if (place.id === 'pawn-cellar') sites.add('tunnel');
    return sites;
  }
  function updateVisibility() {
    const sites = focusSites();
    for (const object of meshes.children) object.visible =
      (!object.userData.chapters || object.userData.chapters.includes(currentChapter)) &&
      (!sites || sites.has(object.userData.site));
    for (const group of actorNodes.values()) {
      const state = group.userData.resident.states[currentChapter];
      group.visible = Boolean(state) && (!sites || sites.has(placeMap.get(state.placeId)?.site));
    }
  }
  function setChapter(id) {
    if (!world.chapters.some(item => item.id === id)) return;
    currentChapter = id;
    const night = id === 'heist' || id === 'aftermath';
    sky.set(night ? '#3c4955' : '#929fa5'); scene.fog.color.copy(sky);
    hemisphere.intensity = night ? 1.1 : 3.0; sun.intensity = night ? 0.7 : 3.0;
    sun.color.set(night ? '#b6cfde' : '#ffdfb0'); renderer.toneMappingExposure = night ? 1.5 : 1.2;
    for (const [actorId, group] of actorNodes) {
      const state = group.userData.resident.states[id];
      group.visible = Boolean(state);
      if (state) { group.position.set(...state.position); group.rotation.y = state.rotation || 0; group.userData.site = state.placeId; }
    }
    updateVisibility();
    requestRender();
  }
  function framedPosition(position, lookAt, bounds) {
    const center = new THREE.Vector3(...lookAt), direction = new THREE.Vector3(...position).sub(center).normalize();
    const right = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const aspect = Math.max(0.4, host.clientWidth / Math.max(1, host.clientHeight));
    let distance = 0;
    for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
      const corner = new THREE.Vector3(x, y, z).sub(center);
      distance = Math.max(distance, corner.dot(direction) + Math.abs(corner.dot(right)) / (tangent * aspect),
        corner.dot(direction) + Math.abs(corner.dot(up)) / tangent);
    }
    return center.addScaledVector(direction, distance * 1.12).toArray();
  }
  function placeCamera(place) {
    if (!place.interior) return place.camera.position;
    const bounds = { min: [...place.bounds.min], max: [...place.bounds.max] };
    bounds.min[1] = place.position[1] - 0.5;
    bounds.max[1] = place.interior ? (place.clipHeight ?? place.position[1] + 1.75) : 9;
    return framedPosition(place.camera.position, placeTarget(place), bounds);
  }
  function placeTarget(place) {
    return place.interior ? [place.camera.target[0], place.position[1] + 0.65, place.camera.target[2]] : place.camera.target;
  }
  function setOrbit(position, lookAt, animate = true) {
    const nextTarget = new THREE.Vector3(...lookAt), offset = new THREE.Vector3(...position).sub(nextTarget);
    const next = { target: nextTarget, radius: offset.length(), polar: Math.acos(offset.y / offset.length()), azimuth: Math.atan2(offset.x, offset.z) };
    if (animate && !reducedMotion) {
      let angle = next.azimuth - azimuth;
      while (angle > Math.PI) angle -= Math.PI * 2; while (angle < -Math.PI) angle += Math.PI * 2;
      transition = { start: performance.now(), from: { target: target.clone(), radius, polar, azimuth }, to: { ...next, azimuth: azimuth + angle } };
    } else { target.copy(next.target); radius = next.radius; polar = next.polar; azimuth = next.azimuth; transition = null; }
    requestRender();
  }
  function focus(id) {
    const place = placeMap.get(id);
    if (!place) return false;
    activePlace = id; autoCutaway = Boolean(place.interior);
    host.dataset.place = id;
    if (walking) {
      const spawn = navigation.spawn(place);
      if (!spawn) return false;
      feet = spawn;
      yaw = Math.atan2(place.camera.target[0] - feet[0], place.camera.target[2] - feet[2]); pitch = 0;
      canvas.focus({ preventScroll: true });
    } else setOrbit(placeCamera(place), placeTarget(place));
    applyClipping(); onPlace(id); return true;
  }
  function overview() {
    walking = false; pressed.clear(); host.dataset.walking = 'false'; cutaway = false; autoCutaway = false;
    setOrbit(framedPosition(world.overview.position, world.overview.target, { min: [-60, -0.5, -50], max: [60, 12, 50] }), world.overview.target); applyClipping();
  }
  function setWalking(enabled) {
    if (Boolean(enabled) === walking) return walking;
    if (enabled) {
      const place = placeMap.get(activePlace) || world.places[0];
      const spawn = navigation.spawn(place);
      if (!spawn) return false;
      feet = spawn; yaw = Math.atan2(place.camera.target[0] - feet[0], place.camera.target[2] - feet[2]); pitch = 0;
      walking = true; transition = null; canvas.focus({ preventScroll: true });
    } else {
      walking = false; pressed.clear();
      const place = placeMap.get(activePlace); if (place) setOrbit(placeCamera(place), placeTarget(place));
    }
    host.dataset.walking = String(walking); applyClipping(); return walking;
  }
  function render(now) {
    scheduled = 0; if (disposed) return;
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
    if (walking) {
      const forward = Number(pressed.has('KeyW') || pressed.has('ArrowUp')) - Number(pressed.has('KeyS') || pressed.has('ArrowDown'));
      const right = Number(pressed.has('KeyD') || pressed.has('ArrowRight')) - Number(pressed.has('KeyA') || pressed.has('ArrowLeft'));
      if (forward || right) {
        const speed = (pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? 4 : 2.2) * dt / Math.max(1, Math.hypot(forward, right));
        feet = navigation.move(feet, (Math.sin(yaw) * forward - Math.cos(yaw) * right) * speed,
          (Math.cos(yaw) * forward + Math.sin(yaw) * right) * speed);
        const location = navigation.locate(feet);
        if (location && location.id !== activePlace) { activePlace = location.id; host.dataset.place = activePlace; onPlace(activePlace); }
      }
      camera.position.set(feet[0], feet[1] + 1.6, feet[2]);
      host.dataset.position = JSON.stringify(feet);
      camera.lookAt(feet[0] + Math.sin(yaw) * Math.cos(pitch), feet[1] + 1.6 + Math.sin(pitch), feet[2] + Math.cos(yaw) * Math.cos(pitch));
    } else {
      if (transition) {
        const progress = Math.min(1, (now - transition.start) / 500), easing = 1 - (1 - progress) ** 3;
        target.lerpVectors(transition.from.target, transition.to.target, easing);
        radius = THREE.MathUtils.lerp(transition.from.radius, transition.to.radius, easing);
        polar = THREE.MathUtils.lerp(transition.from.polar, transition.to.polar, easing);
        azimuth = THREE.MathUtils.lerp(transition.from.azimuth, transition.to.azimuth, easing);
        if (progress >= 1) transition = null;
      }
      camera.position.set(target.x + radius * Math.sin(polar) * Math.sin(azimuth), target.y + radius * Math.cos(polar), target.z + radius * Math.sin(polar) * Math.cos(azimuth));
      camera.lookAt(target);
    }
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    if (width !== viewportWidth || height !== viewportHeight) {
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
      viewportWidth = width; viewportHeight = height;
    }
    const place = placeMap.get(activePlace), indoor = Boolean(place?.interior && (walking || cutaway || autoCutaway));
    const lightTarget = walking ? new THREE.Vector3(...feet) : target;
    indoorFill.intensity = indoor ? 12 : 0;
    indoorFill.position.copy(lightTarget).add(new THREE.Vector3(0, 2.5, 0));
    const nearbyLamps = lampProps.filter(prop => !indoor || prop.site === place.site || prop.site === 'tunnel')
      .map(prop => ({ prop, distance: lightTarget.distanceToSquared(new THREE.Vector3(...prop.position)) }))
      .filter(item => item.distance < 450).sort((a, b) => a.distance - b.distance).slice(0, lights.length);
    lights.forEach((light, index) => {
      const lamp = nearbyLamps[index]?.prop;
      light.intensity = lamp ? (currentChapter === 'heist' || currentChapter === 'aftermath' ? 18 : 9) : 0;
      if (lamp) light.position.set(...lamp.position);
    });
    for (const group of actorNodes.values()) group.userData.label.visible = camera.position.distanceTo(group.position) < 28;
    renderer.render(scene, camera);
    host.dataset.rendered = 'true';
    if (transition || walking && pressed.size) requestRender();
  }
  const raycaster = new THREE.Raycaster();
  function pick(event) {
    if (walking) return;
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
    const hit = raycaster.intersectObjects([meshes, residents], true).find(item => {
      for (let object = item.object; object; object = object.parent) if (!object.visible) return false;
      return !renderer.clippingPlanes.length || item.point.y <= clipping.constant &&
        (renderer.clippingPlanes.length < 2 || item.point.y >= -bottomClipping.constant);
    });
    if (!hit) return;
    let object = hit.object;
    while (object && !object.userData.site) object = object.parent;
    const site = object?.userData.site;
    const place = placeMap.get(site) || world.places.filter(item => item.site === site)
      .sort((a, b) => Math.abs(hit.point.y - a.position[1] - 1) - Math.abs(hit.point.y - b.position[1] - 1))[0];
    if (place) focus(place.id);
  }
  function pointerDown(event) {
    if (event.target !== canvas || event.pointerType === 'mouse' && ![0, 1, 2].includes(event.button)) return;
    canvas.focus({ preventScroll: true }); transition = null;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, pan: event.button !== 0 || event.shiftKey });
    canvas.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    const pointer = pointers.get(event.pointerId); if (!pointer) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      const previous = Math.hypot(pointer.x - other.x, pointer.y - other.y), next = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      if (!walking && previous > 0 && next > 0) radius = Math.max(3, Math.min(230, radius * previous / next));
    } else if (walking) {
      yaw -= dx * 0.006; pitch = Math.max(-1.25, Math.min(1.25, pitch - dy * 0.006));
    } else if (pointer.pan) {
      const scale = radius / Math.max(160, host.clientHeight) * 0.9;
      target.x -= (Math.cos(azimuth) * dx - Math.sin(azimuth) * dy * 0.5) * scale;
      target.z += (Math.sin(azimuth) * dx + Math.cos(azimuth) * dy * 0.5) * scale;
    } else {
      azimuth -= dx * 0.007; polar = Math.max(0.12, Math.min(1.48, polar - dy * 0.007));
    }
    pointer.x = event.clientX; pointer.y = event.clientY; requestRender();
  }
  function pointerEnd(event) {
    const pointer = pointers.get(event.pointerId);
    if (pointer && event.type === 'pointerup' && pointers.size === 1 && Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) < 4) pick(event);
    pointers.delete(event.pointerId);
  }
  function wheel(event) {
    event.preventDefault(); if (walking) return;
    transition = null; radius = Math.max(3, Math.min(230, radius * Math.exp(Math.max(-0.5, Math.min(0.5, event.deltaY * 0.001))))); requestRender();
  }
  function keyDown(event) {
    if (!walking || !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Escape'].includes(event.code)) return;
    event.preventDefault();
    if (event.code === 'Escape') { setWalking(false); return; }
    pressed.add(event.code); lastTime = performance.now(); requestRender();
  }
  const keyUp = event => pressed.delete(event.code);
  const blur = () => { pressed.clear(); pointers.clear(); };
  const contextMenu = event => event.preventDefault();
  const events = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerEnd, pointercancel: pointerEnd,
    lostpointercapture: pointerEnd, wheel, keydown: keyDown, keyup: keyUp, blur, contextmenu: contextMenu };
  for (const [type, listener] of Object.entries(events)) canvas.addEventListener(type, listener, type === 'wheel' ? { passive: false } : undefined);
  window.addEventListener('blur', blur);
  const visibility = () => { if (document.hidden) blur(); };
  document.addEventListener('visibilitychange', visibility);
  const observer = new ResizeObserver(requestRender); observer.observe(host);
  function dispose() {
    if (disposed) return;
    disposed = true; if (scheduled) cancelAnimationFrame(scheduled);
    observer.disconnect(); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility);
    for (const [type, listener] of Object.entries(events)) canvas.removeEventListener(type, listener);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials.values()) material.dispose();
    for (const texture of textures) texture.dispose();
    renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
  }
  host.dataset.walking = 'false'; setChapter(chapter); requestRender();
  return { focus, overview, setWalking, setCutaway(enabled) { cutaway = Boolean(enabled); autoCutaway = false; applyClipping(); },
    setChapter, dispose, getLocation: () => activePlace };
}
