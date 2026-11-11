import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCampExperience, createPrototypeExperience } from './creation/index.mjs';
import { createHttpServer } from './transport/http-server.mjs';
import { createStoryExperience } from './creation/story-experience.mjs';

export { createCampExperience, createPrototypeExperience };

const root = dirname(fileURLToPath(import.meta.url));

export function createCampServer({ withCreation = true, ...options } = {}) {
  const experience = withCreation ? createPrototypeExperience(options) : createCampExperience(options);
  return createHttpServer({ experience, assetRoot: root });
}

export function createStoryServer(options = {}) {
  const story = createStoryExperience({ stateFile: resolve(root, '.data/prototype/story-chat.json'), ...options });
  const experience = { state: story.state, control: () => ({ ok: false, message: '请使用地点和时段菜单探索。' }),
    cancelModel: story.cancel, close: story.close };
  return createHttpServer({ experience, assetRoot: root, story });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const port = args.length ? Number(/^--port=(\d+)$/.exec(args[0])?.[1]) : 5175;
  if (args.length > 1 || !Number.isSafeInteger(port) || port < 1024 || port > 65535) { console.error('Usage: node server.mjs [--port=5175]'); process.exitCode = 1; }
  else {
    const { server, experience } = createStoryServer();
    server.on('error', () => { console.error('原型服务无法启动，可能端口已占用。'); experience.close(); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Wispiva · 红发会：http://127.0.0.1:${port}\n预制故事世界；启动、探索和地点导航不会调用模型。`));
    const stop = () => { experience.cancelModel(); server.close(() => process.exit()); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
  }
}
