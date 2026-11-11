import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exists, readJSON, writeJSONAtomic, moveFile, appendAudit } from './files.mjs';

export function createWorldRepository(stateFile) {
  const directory = dirname(stateFile);
  const creationFile = join(directory, 'creation.json');
  const archiveFile = id => {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('世界归档标识无效');
    return join(directory, 'worlds', `${id}.json`);
  };
  return {
    activeExists: () => exists(stateFile),
    readCreation() {
      if (!exists(creationFile)) return null;
      try {
        const value = readJSON(creationFile);
        if (value?.schemaVersion !== 1) throw new Error('不支持的创建存档版本');
        return value;
      } catch (cause) {
        throw new Error('创建存档无法读取或格式损坏，原文件已保留；请恢复 creation.json 后重启。', { cause });
      }
    },
    saveCreation: value => writeJSONAtomic(creationFile, value, { mkdir: true, directoryMode: 0o700 }),
    voxelFile: id => {
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('体素草稿标识无效');
      return join(directory, `voxel-${id}.json`);
    },
    archiveFile,
    saveArchive: (id, value) => writeJSONAtomic(archiveFile(id), value, { mkdir: true, directoryMode: 0o700, validateJSON: true }),
    isGeneratedArchive(id) {
      try {
        const head = readJSON(archiveFile(id));
        return head.scenario === 'generated-world-v1' && head.world?.profile === 'generated-world';
      } catch { return false; }
    },
    retireLegacy() {
      if (!exists(stateFile) || readJSON(stateFile).scenario !== 'beast-camp-v1') return false;
      moveFile(stateFile, join(directory, 'retired', `beast-camp-${randomUUID()}.json`), { mkdir: true });
      return true;
    },
    audit: value => appendAudit(join(directory, 'model-calls.jsonl'), value),
  };
}
