// Keep browser code public without making domain code, saves, or config files
// reachable through a filesystem route. New browser modules must be listed here.
const browserModules = [
  'ui/app.js',
  'ui/transport.js',
  'residents/actor-location-summary.mjs',
  'rendering/scene.js',
  'rendering/world-scene.js',
  'rendering/voxel-scene.js',
  'rendering/camp-compiler.js',
  'rendering/scene-compiler.js',
  'rendering/compiled-spatial.js',
  'rendering/materials.js',
  'rendering/primitives.js',
  'rendering/solid.js',
  'rendering/voxel.js',
  'spatial/camp-document.js',
  'spatial/normalize-world-scene.js',
  'spatial/scene-document.js',
  'spatial/scene-fixtures.js',
  'spatial/scene-validation.js',
  'spatial/voxel-inspection.js',
  'spatial/voxel-bindings.mjs',
  'spatial/world-bindings.js',
  'spatial/world-document.js',
];

const assets = {
  '/': ['ui/index.html', 'text/html'],
  '/ui/index.html': ['ui/index.html', 'text/html'],
  '/ui/style.css': ['ui/style.css', 'text/css'],
  ...Object.fromEntries(browserModules.map(file => [`/${file}`, [file, 'text/javascript']])),
  '/vendor/three.module.js': ['node_modules/three/build/three.module.js', 'text/javascript'],
  '/vendor/three.core.js': ['node_modules/three/build/three.core.js', 'text/javascript'],
  '/vendor/BufferGeometryUtils.js': ['node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', 'text/javascript'],
};

// Preserve the previous public URLs through explicit aliases only.
const aliases = {
  '/app.js': '/ui/app.js',
  '/transport.js': '/ui/transport.js',
  '/style.css': '/ui/style.css',
  '/actor-location-summary.mjs': '/residents/actor-location-summary.mjs',
  '/scene.js': '/rendering/scene.js',
  '/world-scene.js': '/rendering/world-scene.js',
  '/voxel-scene.js': '/rendering/voxel-scene.js',
  '/geometry/camp-compiler.js': '/rendering/camp-compiler.js',
  '/geometry/scene-compiler.js': '/rendering/scene-compiler.js',
  '/geometry/compiled-spatial.js': '/rendering/compiled-spatial.js',
  '/geometry/materials.js': '/rendering/materials.js',
  '/geometry/primitives.js': '/rendering/primitives.js',
  '/geometry/solid.js': '/rendering/solid.js',
  '/geometry/voxel.js': '/rendering/voxel.js',
  '/geometry/camp-document.js': '/spatial/camp-document.js',
  '/geometry/normalize-world-scene.js': '/spatial/normalize-world-scene.js',
  '/geometry/scene-document.js': '/spatial/scene-document.js',
  '/geometry/scene-fixtures.js': '/spatial/scene-fixtures.js',
  '/geometry/scene-validation.js': '/spatial/scene-validation.js',
  '/geometry/voxel-inspection.js': '/spatial/voxel-inspection.js',
  '/geometry/world-bindings.js': '/spatial/world-bindings.js',
  '/geometry/world-document.js': '/spatial/world-document.js',
};

for (const asset of Object.values(assets)) Object.freeze(asset);
Object.freeze(assets);

export function getPublicAsset(path) {
  const canonicalPath = Object.hasOwn(aliases, path) ? aliases[path] : path;
  return Object.hasOwn(assets, canonicalPath) ? assets[canonicalPath] : null;
}
