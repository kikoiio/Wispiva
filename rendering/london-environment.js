import * as THREE from '/vendor/three.module.js';
import { createLondonBlock } from '../spatial/london-blocks.js';

export function createLondonEnvironment(scene, world, materialFor) {
  if (!world.environment) return { update() {}, dispose() {}, stats: () => ({ blocks: 0, buildings: 0 }) };
  const root = new THREE.Group(); scene.add(root);
  const box = new THREE.BoxGeometry(1, 1, 1), transform = new THREE.Object3D();
  const blocks = new Map(), configuration = world.environment;
  const windowMaterial = materialFor('glass').clone();
  windowMaterial.transparent = false; windowMaterial.opacity = 1; windowMaterial.depthWrite = true;
  windowMaterial.color.set('#526b72'); windowMaterial.roughness = 0.38;
  const skyGeometry = new THREE.SphereGeometry(3500, 24, 16);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#8198a5') }, horizon: { value: new THREE.Color('#b8b5a8') }, night: { value: 0 } },
    vertexShader: 'varying vec3 direction; void main(){ direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 direction; uniform vec3 top; uniform vec3 horizon; uniform float night;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){vec3 d=normalize(direction); float elevation=max(0.0,d.y); vec3 color=mix(horizon,top,pow(elevation,0.5));
        vec2 p=d.xz/(0.18+max(0.0,d.y))*2.0; float cloud=noise(p)*0.65+noise(p*2.1)*0.35;
        color=mix(color,vec3(0.82,0.82,0.78),smoothstep(0.46,0.72,cloud)*smoothstep(0.0,0.15,elevation)*(1.0-night)*0.45);
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial); sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  const groundGeometry = new THREE.PlaneGeometry(14000, 14000);
  const groundUv = groundGeometry.getAttribute('uv');
  for (let index = 0; index < groundUv.count; index++) groundUv.setXY(index, groundUv.getX(index) * 14000, groundUv.getY(index) * 14000);
  const ground = new THREE.Mesh(groundGeometry, materialFor('cobble')); ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.012; ground.receiveShadow = true; root.add(ground);
  const laneRoot = new THREE.Group(); root.add(laneRoot);
  function surfacesGeometry(surfaces) {
    const positions = [], normals = [], uvs = [];
    for (const surface of surfaces) {
      const [x, y, z] = surface.position, [width, depth] = surface.size;
      for (const [u, v] of [[0, 0], [0, 1], [1, 1], [0, 0], [1, 1], [1, 0]]) {
        positions.push(x + (u - 0.5) * width, y, z + (v - 0.5) * depth);
        normals.push(0, 1, 0); uvs.push(x + (u - 0.5) * width, z + (v - 0.5) * depth);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.computeBoundingSphere();
    return geometry;
  }
  const laneGeometries = [];
  function addSurfaces(parent, surfaces, owned) {
    const materials = new Map();
    for (const surface of surfaces) {
      if (!materials.has(surface.material)) materials.set(surface.material, []);
      materials.get(surface.material).push(surface);
    }
    for (const [name, records] of materials) {
      const geometry = surfacesGeometry(records), mesh = new THREE.Mesh(geometry, materialFor(name));
      owned.push(geometry); mesh.receiveShadow = true; parent.add(mesh);
    }
  }
  addSurfaces(laneRoot, world.surfaces || [], laneGeometries);
  function buildBlock(ix, iz) {
    const data = createLondonBlock(configuration, ix, iz), group = new THREE.Group(), owned = [];
    const buckets = new Map();
    for (const prop of data.props) {
      const key = `${prop.kind}:${prop.material}:${prop.detail}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(prop);
    }
    for (const records of buckets.values()) {
      const first = records[0], mesh = new THREE.InstancedMesh(box,
        /glass/.test(first.material) ? windowMaterial : materialFor(`${first.kind === 'lamp' ? 'lamp:' : ''}${first.material}`), records.length);
      records.forEach((record, index) => {
        transform.position.set(...record.position); transform.scale.set(...record.size); transform.rotation.set(0, record.rotation || 0, 0);
        transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      mesh.userData.detail = first.detail;
      mesh.castShadow = first.detail === 'structure'; mesh.receiveShadow = first.detail !== 'detail'; group.add(mesh);
    }
    addSurfaces(group, data.surfaces.map((surface, index) => ({ ...surface, position: [surface.position[0], -0.008 + (surface.material === 'pavement' ? 0.002 : 0), surface.position[2]] })), owned);
    root.add(group);
    return { group, owned, bounds: data.bounds, buildings: data.buildings.length };
  }
  function removeBlock(key) {
    const block = blocks.get(key); if (!block) return;
    root.remove(block.group); block.group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    for (const geometry of block.owned) geometry.dispose(); blocks.delete(key);
  }
  let previousKey = '', previousNight;
  function update(camera, center, { night = false, cutaway = false } = {}) {
    root.visible = !cutaway; sky.position.copy(camera.position);
    if (previousNight !== night) {
      previousNight = night; skyMaterial.uniforms.night.value = Number(night);
      skyMaterial.uniforms.top.value.set(night ? '#142839' : '#8198a5');
      skyMaterial.uniforms.horizon.value.set(night ? '#45505a' : '#b8b5a8');
      windowMaterial.emissive.set(night ? '#b7924d' : '#000000'); windowMaterial.emissiveIntensity = night ? 0.4 : 0;
    }
    if (cutaway) return;
    const size = configuration.blockSize, [ox, oz] = configuration.origin;
    const ix = Math.floor((center.x - ox) / size), iz = Math.floor((center.z - oz) / size);
    const key = `${ix},${iz}`;
    ground.position.x = ix * size; ground.position.z = iz * size;
    if (key !== previousKey) {
      previousKey = key;
      const wanted = new Set();
      for (let x = ix - 3; x <= ix + 3; x++) for (let z = iz - 3; z <= iz + 3; z++) wanted.add(`${x},${z}`);
      for (const old of blocks.keys()) if (!wanted.has(old)) removeBlock(old);
      // Work from the closest blocks outward so the first visible street is ready first.
      const missing = [...wanted].filter(id => !blocks.has(id)).map(id => id.split(',').map(Number))
        .sort((a, b) => Math.hypot(a[0] - ix, a[1] - iz) - Math.hypot(b[0] - ix, b[1] - iz));
      for (const [x, z] of missing) blocks.set(`${x},${z}`, buildBlock(x, z));
    }
    for (const block of blocks.values()) {
      const x = Math.max(block.bounds.min[0], Math.min(camera.position.x, block.bounds.max[0]));
      const z = Math.max(block.bounds.min[2], Math.min(camera.position.z, block.bounds.max[2]));
      const distance = Math.hypot(x - camera.position.x, z - camera.position.z);
      for (const object of block.group.children) {
        object.visible = object.userData.detail === 'detail' ? distance < 145
          : object.userData.detail === 'street' ? distance < 215 : true;
        if (object.isInstancedMesh) object.castShadow = object.userData.detail === 'structure' && distance < 95;
      }
    }
  }
  function dispose() {
    for (const key of [...blocks.keys()]) removeBlock(key);
    for (const geometry of laneGeometries) geometry.dispose();
    box.dispose(); groundGeometry.dispose(); skyGeometry.dispose(); skyMaterial.dispose(); windowMaterial.dispose(); scene.remove(root, sky);
  }
  return { update, dispose, stats: () => ({ blocks: blocks.size, buildings: [...blocks.values()].reduce((count, block) => count + block.buildings, 0) }) };
}
