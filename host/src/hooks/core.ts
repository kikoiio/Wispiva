import type OpenAI from "openai";

export interface PreToolUseCall {
  name: string;
  args: unknown;
  argsJson: string;
}

export interface PostToolUseCall extends PreToolUseCall {
  output: string;
}

export interface HookMap {
  // The user submitted a line.
  UserPromptSubmit: (line: string) => void;
  // First non-undefined result blocks the tool call with that message.
  PreToolUse: (call: PreToolUseCall) => Promise<string | undefined> | string | undefined;
  // A tool call finished. Calls blocked by PreToolUse do not fire this.
  PostToolUse: (call: PostToolUseCall) => void;
  // A loop stopped without tool calls. First string result is injected
  // as a user message and the loop continues.
  Stop: (messages: OpenAI.Responses.ResponseInput) => string | undefined;
}

const hooks: { [K in keyof HookMap]: Array<HookMap[K]> } = {
  UserPromptSubmit: [],
  PreToolUse: [],
  PostToolUse: [],
  Stop: [],
};

export function registerHook<K extends keyof HookMap>(event: K, hook: HookMap[K]): void {
  hooks[event].push(hook);
}

// Hooks run in registration order; the first non-undefined result wins.
export async function triggerHooks<K extends keyof HookMap>(
  event: K,
  ...args: Parameters<HookMap[K]>
): Promise<Awaited<ReturnType<HookMap[K]>>> {
  const list = hooks[event] as Array<(...a: unknown[]) => unknown>;
  for (const hook of list) {
    const result = await hook(...args);
    if (result !== undefined) return result as Awaited<ReturnType<HookMap[K]>>;
  }
  return undefined as Awaited<ReturnType<HookMap[K]>>;
}
