import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const exists = path => existsSync(path);
export const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));

export function writeJSONAtomic(path, value, { mkdir = false, directoryMode, mode = 0o600, newline = true, validateJSON = false } = {}) {
  const serialized = JSON.stringify(value) + (newline ? '\n' : '');
  if (validateJSON && !isDeepStrictEqual(JSON.parse(serialized), value)) throw new Error('non-json-save');
  if (mkdir) mkdirSync(dirname(path), { recursive: true, ...(directoryMode === undefined ? {} : { mode: directoryMode }) });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, serialized, { encoding: 'utf8', mode, flag: 'wx' });
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); }
    catch (cleanupError) { if (cleanupError.code !== 'ENOENT') error.cleanupError = cleanupError; }
    throw error;
  }
}

export function moveFile(from, to, { mkdir = false, directoryMode = 0o700 } = {}) {
  if (mkdir) mkdirSync(dirname(to), { recursive: true, mode: directoryMode });
  renameSync(from, to);
}

export function appendAudit(path, value) {
  appendFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}
