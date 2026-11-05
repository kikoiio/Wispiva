// Keep one model request small enough to inspect and retry without discarding a
// large batch of otherwise useful work. Low-level voxel tools still support
// larger batches for deterministic fixtures and future callers.
export { MAX_BUILD_COMMANDS } from '../voxel/building-limits.mjs';
export const MAX_BUILD_LOOP_ITERATIONS = 4;
export const MODEL_REQUEST_TIMEOUT_MS = 180_000;
export const MAX_SOURCE_CHARACTERS = 5_000_000;
