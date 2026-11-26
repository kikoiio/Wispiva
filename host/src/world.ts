import { connect } from "node:net";
import { worldHost, worldPort } from "./config.ts";

export type WorldResult = {
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
};

const agentTools = new Set([
  "look", "inspect", "sense_mana", "status", "move_to", "toggle_lock",
  "transfer_item", "cart", "work_craft", "rest", "speak", "trade", "guild_contract",
  "suppress_mana", "cast_spell",
]);

export class WorldClient {
  #socket: ReturnType<typeof connect> | null = null;
  #buffer = "";
  #waiters: PromiseWithResolvers<string>[] = [];
  #next = 1;

  connect(port = worldPort): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: worldHost, port }, () => resolve());
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        this.#buffer += chunk;
        let nl = this.#buffer.indexOf("\n");
        while (nl >= 0) {
          const line = this.#buffer.slice(0, nl);
          this.#buffer = this.#buffer.slice(nl + 1);
          const waiter = this.#waiters.shift();
          if (waiter) waiter.resolve(line);
          nl = this.#buffer.indexOf("\n");
        }
      });
      socket.on("error", reject);
      socket.on("close", () => {
        this.#socket = null;
        for (const waiter of this.#waiters.splice(0)) {
          waiter.reject(new Error("The world connection closed."));
        }
      });
      this.#socket = socket;
    });
  }

  close(): void {
    this.#socket?.destroy();
    this.#socket = null;
  }

  async call(role: "agent" | "host", tool: string, args: Record<string, unknown> = {}, agentId = ""): Promise<WorldResult> {
    if (role === "agent" && !agentTools.has(tool)) {
      return { id: "", ok: false, error: { code: "forbidden", message: `${tool} is not a character tool` } };
    }
    if (this.#socket === null) {
      return { id: "", ok: false, error: { code: "disconnected", message: "The world connection closed." } };
    }
    const socket = this.#socket;
    const id = String(this.#next++);
    const payload = JSON.stringify({ id, role, agentId, tool, args }) + "\n";
    const reply = Promise.withResolvers<string>();
    this.#waiters.push(reply);
    socket.write(payload, (error) => {
      if (!error) return;
      this.#waiters.splice(this.#waiters.indexOf(reply), 1);
      reply.reject(error);
    });
    return parseResult(await reply.promise);
  }
}

function parseResult(line: string): WorldResult {
  const parsed: unknown = JSON.parse(line);
  if (!isRecord(parsed) || typeof parsed.id !== "string" || typeof parsed.ok !== "boolean") {
    return { id: "", ok: false, error: { code: "bad_json", message: "world returned an unexpected payload" } };
  }
  const error = isRecord(parsed.error) && typeof parsed.error.code === "string" && typeof parsed.error.message === "string"
    ? { code: parsed.error.code, message: parsed.error.message }
    : undefined;
  const result = isRecord(parsed.result) ? parsed.result : undefined;
  return { id: parsed.id, ok: parsed.ok, result, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
