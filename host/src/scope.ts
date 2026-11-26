import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import { dataRoot } from "./config.ts";
import { isAgentName } from "./names.ts";

const storage = new AsyncLocalStorage<string>();

export function agentDirectory(agentId: string): string {
  if (!isAgentName(agentId)) throw new Error(`invalid agent id: ${agentId}`);
  return resolve(dataRoot, "agents", agentId);
}

export function bindAgent<T>(agentId: string, run: () => T): T {
  if (!isAgentName(agentId)) throw new Error(`invalid agent id: ${agentId}`);
  return storage.run(agentId, run);
}

export function boundAgentId(): string {
  const agentId = storage.getStore();
  if (agentId === undefined) throw new Error("no agent is bound");
  return agentId;
}
