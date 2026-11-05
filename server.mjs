import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCampExperience, createPrototypeExperience } from './creation/index.mjs';
import { createHttpServer } from './transport/http-server.mjs';

export { createCampExperience, createPrototypeExperience };

const root = dirname(fileURLToPath(import.meta.url));

export function createCampServer({ withCreation = true, ...options } = {}) {
  const experience = withCreation ? createPrototypeExperience(options) : createCampExperience(options);
  return createHttpServer({ experience, assetRoot: root });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const port = args.length ? Number(/^--port=(\d+)$/.exec(args[0])?.[1]) : 5175;
  if (args.length > 1 || !Number.isSafeInteger(port) || port < 1024 || port > 65535) { console.error('Usage: node server.mjs [--port=5175]'); process.exitCode = 1; }
  else {
    const { server, experience } = createCampServer();
    server.on('error', () => { console.error('原型服务无法启动，可能端口已占用。'); experience.close(); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Wispiva 主原型：http://127.0.0.1:${port}\n从文字创建世界；启动与观看不会调用模型。`));
    const stop = () => { experience.cancelModel(); server.close(() => process.exit()); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
  }
}
