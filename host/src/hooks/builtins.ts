import { registerHook, type PreToolUseCall } from "./core.ts";

const shellNames = new Set([
  "bash",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "load_skill",
]);

const hostOnlyNames = new Set([
  "world_step",
  "world_snapshot",
  "world_inject_event",
  "host_pending",
  "host_nav",
]);

const denial = "character agents have no host filesystem tools";

function bareToolName(name: string): string {
  const parts = name.split("__");
  if (parts.length >= 3 && parts[0] === "mcp") return parts.slice(2).join("__");
  return name;
}

export function characterToolDenial(name: string): string | undefined {
  const bare = bareToolName(name);
  if (shellNames.has(bare) || hostOnlyNames.has(bare)) return denial;
  if (name.includes("bash") || name.includes("read_file") || name.includes("write_file")) return denial;
  return undefined;
}

let installed = false;

export function installCharacterHooks(): void {
  if (installed) return;
  installed = true;
  registerHook("PreToolUse", (call: PreToolUseCall) => characterToolDenial(call.name));
}
