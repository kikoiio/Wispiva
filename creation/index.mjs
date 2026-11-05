import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorldCreation } from './world-creation.mjs';
import { createCampExperience } from './world-runtime.mjs';

export { createCampExperience };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function createPrototypeExperience(options = {}) {
  return createWorldCreation({ stateFile: join(root, '.data/prototype/state.json'), ...options, createExperience: createCampExperience });
}
