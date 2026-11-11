import { compileScene, disposeWorld } from './scene-compiler.js';
import { createPlainMaterials } from './materials.js';

// The caller validates scene semantics first. This adapter owns compilation
// and disposal, including failures, without changing the candidate document.
export function checkCompiledScene(document) {
  let compiled;
  const materials = document?.profile === 'world' ? createPlainMaterials() : null;
  try {
    compiled = compileScene(document, 'solid', materials ? { materials, details: false } : {});
    return { ok: true };
  } catch (error) {
    return { ok: false, diagnostics: error.diagnostics };
  } finally {
    if (compiled) disposeWorld(compiled);
    if (materials) for (const material of Object.values(materials)) material.dispose();
  }
}
