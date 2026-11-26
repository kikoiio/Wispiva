import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");

export const projectRoot = resolve(packageRoot, "..");
export const dataRoot = resolve(projectRoot, ".data");

export const worldHost = "127.0.0.1";

const portText = process.env.WISPIVA_WORLD_PORT ?? "7777";
const port = Number(portText);
export const worldPort = Number.isInteger(port) && port > 0 && port < 65536 ? port : 7777;

export const OPENAI_MODEL = process.env.OPENAI_MODEL;
