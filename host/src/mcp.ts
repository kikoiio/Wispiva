import type OpenAI from "openai";
import { boundAgentId } from "./scope.ts";
import type { WorldClient } from "./world.ts";

const disallowedName = /[^a-zA-Z0-9_-]/g;
const maxToolNameLength = 64;

export type McpPolicy = "allow" | "confirm";

type JsonType = "string" | "number" | "integer" | "boolean";

interface McpToolDraft {
  name: string;
  description: string;
  inputSchema: unknown;
}

type McpHandler = (args: Record<string, unknown>) => Promise<string> | string;

interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: unknown;
  invoke: McpHandler;
}

interface BoundTool {
  prefixed: string;
  origin: string;
  policy: McpPolicy;
  definition: OpenAI.Responses.FunctionTool;
  invoke: McpHandler;
}

interface ToolField {
  name: string;
  type: JsonType;
  description: string;
  required: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonType(value: unknown): value is JsonType {
  return value === "string" || value === "number" || value === "integer" || value === "boolean";
}

export function normalizeMcpName(name: string): string {
  const normalized = name.replace(disallowedName, "_");
  if (normalized === "") throw new Error("MCP names cannot normalize to an empty string");
  return normalized;
}

function schemaOf(fields: readonly ToolField[]): Record<string, unknown> {
  const properties: Record<string, { type: JsonType; description: string }> = {};
  const required: string[] = [];
  for (const field of fields) {
    properties[field.name] = { type: field.type, description: field.description };
    if (field.required) required.push(field.name);
  }
  return { type: "object", properties, required };
}

function field(name: string, type: JsonType, description: string, required: boolean): ToolField {
  return { name, type, description, required };
}

const characterToolDrafts: McpToolDraft[] = [
  {
    name: "look",
    description: "Look for visible people, doors, fixtures, and traces. Walls, closed doors, darkness, and trees block sight. You do not learn anyone else's inventory, coins, keys, or true mana.",
    inputSchema: schemaOf([field("focus", "string", "Optional direction or landmark.", false)]),
  },
  {
    name: "inspect",
    description: "Examine a nearby object, trace, door, or person.",
    inputSchema: schemaOf([field("target_id", "string", "Id of the nearby target.", true)]),
  },
  {
    name: "sense_mana",
    description: "Sense apparent mana. pulse alerts other mages without naming you. passive does not.",
    inputSchema: schemaOf([field("mode", "string", "pulse or passive.", true)]),
  },
  {
    name: "status",
    description: "Your own position, burden, body, hunger, wounds, mana, and coins.",
    inputSchema: schemaOf([]),
  },
  {
    name: "move_to",
    description: "Start walking, running, or sneaking. The world wakes you with the result when you arrive or meet a blocker.",
    inputSchema: schemaOf([
      field("destination", "string", "Place name, visible fixture ID, a person's name, or x,y,z text.", true),
      field("pace", "string", "walk, run, or sneak.", true),
    ]),
  },
  {
    name: "toggle_lock",
    description: "Open, close, lock, or unlock a door you can reach, if your key fits.",
    inputSchema: schemaOf([
      field("door_id", "string", "Door id.", true),
      field("action", "string", "open, close, lock, or unlock.", true),
    ]),
  },
  {
    name: "transfer_item",
    description: "Handle nearby items, eat provisions, drink spring water, dress wounds with a bandage, or splint a fracture with a timber brace.",
    inputSchema: schemaOf([
      field("item_id", "string", "Item id.", true),
      field("action", "string", "pick, drop, give, store, consume a provision, treat an injury, or spill one oil_flask.", true),
      field("target_agent", "string", "Recipient when giving, or patient when treating. Omit to treat yourself.", false),
      field("container_id", "string", "Container ID when storing.", false),
      field("quantity", "integer", "How many.", true),
    ]),
  },
  {
    name: "cart",
    description: "Handle a nearby mule cart. A hitched cart follows you along roads and can ride an empty ferry.",
    inputSchema: schemaOf([
      field("cart_id", "string", "ID of the cart.", true),
      field("action", "string", "hitch, unhitch, load, or unload.", true),
      field("item_id", "string", "Item to load or unload.", false),
      field("quantity", "integer", "Number of items to load or unload.", false),
    ]),
  },
  {
    name: "work_craft",
    description: "Start work at a nearby station. The world wakes you with the result when the work finishes.",
    inputSchema: schemaOf([
      field("station_id", "string", "Station id.", true),
      field("recipe_or_task", "string", "Recipe or task name.", true),
      field("minutes", "integer", "Minutes to spend.", true),
    ]),
  },
  {
    name: "rest",
    description: "Rest to recover stamina and sleep. Shelter and nearby fire help you dry and warm up. An hour or more restores mana faster. Splinted fractures need days of rest.",
    inputSchema: schemaOf([
      field("minutes", "integer", "Minutes to rest.", true),
      field("location_id", "string", "Optional place id.", false),
    ]),
  },
  {
    name: "speak",
    description: "Say something aloud. Whisper carries about 6 m, a normal voice 20 m, a shout 65 m. Walls muffle it. The world does not mark truth.",
    inputSchema: schemaOf([
      field("utterance", "string", "The words you say.", true),
      field("volume", "string", "whisper, normal, or shout.", true),
    ]),
  },
  {
    name: "trade",
    description: "Offer a nearby trade. Both sides must agree before anything changes hands.",
    inputSchema: schemaOf([
      field("partner_id", "string", "The other person's id.", true),
      field("offer_item", "string", "Item or sp/cp you offer.", true),
      field("offer_qty", "integer", "Amount offered.", true),
      field("request_item", "string", "Item or sp/cp you want.", true),
      field("request_qty", "integer", "Amount requested.", true),
    ]),
  },
  {
    name: "guild_contract",
    description: "Use the nearby guild board. Delivery contracts require the goods before payout. Service contracts require the poster to confirm the work before the holder collects the reward. Posters collect delivered goods at the board.",
    inputSchema: schemaOf([
      field("action", "string", "list, post, accept, complete, confirm a service as poster, or collect delivered goods as poster.", true),
      field("contract_id", "string", "Contract id when one is needed.", false),
      field("summary", "string", "Text of a new contract.", false),
      field("reward_sp", "integer", "Silver pieces escrowed for a new contract.", false),
      field("delivery_item", "string", "Required item for a delivery contract. Omit for a service requiring poster confirmation.", false),
      field("delivery_qty", "integer", "Required item quantity for a delivery contract.", false),
    ]),
  },
  {
    name: "suppress_mana",
    description: "Hide your mana. While hidden, instant spells cost from half your usual cap.",
    inputSchema: schemaOf([
      field("enabled", "boolean", "True to hide, false to stop.", true),
      field("apparent_level", "integer", "How strong you appear while hidden.", false),
    ]),
  },
  {
    name: "cast_spell",
    description: "Cast light, flame, barrier, bandage, mend, or an unseal ritual you have learned. You need mana and a clear line.",
    inputSchema: schemaOf([
      field("spell_name", "string", "Spell name.", true),
      field("target", "string", "Target id or direction.", true),
      field("mana_spend", "integer", "Mana to spend.", true),
    ]),
  },
];

export function worldToolNames(): string[] {
  return characterToolDrafts.map((draft) => `mcp__world__${normalizeMcpName(draft.name)}`);
}

function invalidSchema(origin: string): Error {
  return new Error(`Invalid input schema for ${origin}`);
}

function parseProperty(value: unknown, origin: string): { type: JsonType; description?: string } {
  if (!isPlainObject(value) || !isJsonType(value.type)) throw invalidSchema(origin);
  for (const key of Object.keys(value)) {
    if (key !== "type" && key !== "description") throw invalidSchema(origin);
  }
  if (value.description === undefined) return { type: value.type };
  if (typeof value.description !== "string") throw invalidSchema(origin);
  return { type: value.type, description: value.description };
}

function strictParameters(schema: unknown, origin: string): { [key: string]: unknown } {
  if (!isPlainObject(schema)) throw invalidSchema(origin);
  if (schema.type !== undefined && schema.type !== "object") throw invalidSchema(origin);
  const rawProperties = schema.properties === undefined ? {} : schema.properties;
  if (!isPlainObject(rawProperties)) throw invalidSchema(origin);
  const rawRequired = schema.required === undefined ? [] : schema.required;
  if (!Array.isArray(rawRequired)) throw invalidSchema(origin);
  const requiredNames: string[] = [];
  for (const item of rawRequired) {
    if (typeof item !== "string") throw invalidSchema(origin);
    requiredNames.push(item);
  }
  const properties: { [key: string]: { [key: string]: unknown } } = {};
  const required: string[] = [];
  for (const [key, raw] of Object.entries(rawProperties)) {
    const property = parseProperty(raw, origin);
    const encoded: { [key: string]: unknown } = {
      type: requiredNames.includes(key) ? property.type : [property.type, "null"],
    };
    if (property.description !== undefined) encoded.description = property.description;
    properties[key] = encoded;
    required.push(key);
  }
  for (const key of requiredNames) {
    if (!Object.hasOwn(properties, key)) throw invalidSchema(origin);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function compileServer(serverName: string, drafts: readonly McpToolDraft[], handlers: Readonly<Record<string, McpHandler>>): McpToolSpec[] {
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (draft.name === "") throw new Error("Every MCP tool needs a non-empty name");
    if (seen.has(draft.name)) throw new Error(`Duplicate MCP tool name on server '${serverName}'`);
    seen.add(draft.name);
  }
  const missing = drafts.filter((draft) => handlers[draft.name] === undefined).map((draft) => draft.name);
  if (missing.length > 0) throw new Error(`Missing MCP handlers: ${missing.join(", ")}`);
  return drafts.map((draft) => {
    const invoke = handlers[draft.name];
    if (invoke === undefined) throw new Error(`Missing MCP handlers: ${draft.name}`);
    return { name: draft.name, description: draft.description, inputSchema: draft.inputSchema, invoke };
  });
}

function worldArgs(args: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "agentId" || key === "role" || value === null) continue;
    copy[key] = value;
  }
  return copy;
}

export class McpRegistry {
  #servers = new Map<string, string>();
  #bindings = new Map<string, BoundTool>();

  addServer(
    name: string,
    drafts: readonly McpToolDraft[],
    handlers: Readonly<Record<string, McpHandler>>,
    reserved: ReadonlySet<string> = new Set(),
  ): string {
    if (this.#servers.has(name)) return `MCP server '${name}' already connected`;
    const tools = compileServer(name, drafts, handlers);
    const origins = new Map<string, string>();
    for (const builtin of reserved) origins.set(builtin, `built-in tool '${builtin}'`);
    for (const binding of this.#bindings.values()) origins.set(binding.prefixed, binding.origin);
    const safeServer = normalizeMcpName(name);
    const bindings: BoundTool[] = [];
    for (const tool of tools) {
      const prefixed = `mcp__${safeServer}__${normalizeMcpName(tool.name)}`;
      if (prefixed.length > maxToolNameLength) {
        throw new Error(`MCP tool name is longer than 64 characters: ${prefixed}`);
      }
      const origin = `MCP tool '${name}'/'${tool.name}'`;
      const previous = origins.get(prefixed);
      if (previous !== undefined) {
        throw new Error(`MCP tool name collision after normalization: '${prefixed}' maps both ${previous} and ${origin}`);
      }
      origins.set(prefixed, origin);
      bindings.push({
        prefixed,
        origin,
        policy: name === "world" ? "allow" : "confirm",
        invoke: tool.invoke,
        definition: {
          type: "function",
          name: prefixed,
          description: tool.description,
          parameters: strictParameters(tool.inputSchema, origin),
          strict: true,
        },
      });
    }
    for (const binding of bindings) this.#bindings.set(binding.prefixed, binding);
    this.#servers.set(name, name);
    const discovered = tools.map((tool) => tool.name).join(", ");
    return `Connected to MCP server '${name}'. Discovered ${tools.length} tools: ${discovered}`;
  }

  has(name: string): boolean {
    return this.#servers.has(name);
  }

  toolDefinitions(reserved: ReadonlySet<string>): OpenAI.Responses.FunctionTool[] {
    const definitions: OpenAI.Responses.FunctionTool[] = [];
    for (const binding of this.#bindings.values()) {
      if (reserved.has(binding.prefixed)) {
        throw new Error(
          `MCP tool name collision after normalization: '${binding.prefixed}' maps both built-in tool '${binding.prefixed}' and ${binding.origin}`,
        );
      }
      definitions.push(binding.definition);
    }
    return definitions;
  }

  async call(prefixed: string, args: unknown): Promise<string> {
    const binding = this.#bindings.get(prefixed);
    if (!binding) return `MCP error: unknown tool '${prefixed}'`;
    if (!isPlainObject(args)) return "MCP error: TypeError: arguments must be an object";
    try {
      return String(await binding.invoke(args));
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      return `MCP error: ${name}: ${message}`;
    }
  }

  policy(prefixed: string): McpPolicy {
    return this.#bindings.get(prefixed)?.policy ?? "confirm";
  }

  connectedLine(): string {
    if (this.#servers.size === 0) return "";
    return `Connected MCP servers: ${[...this.#servers.keys()].join(", ")}`;
  }

  appendNotice(body: string): string {
    const line = this.connectedLine();
    return line === "" ? body : `${body}\n\n${line}`;
  }
}

export const mcpRegistry = new McpRegistry();

export function attachWorld(client: WorldClient): string {
  if (mcpRegistry.has("world")) return "MCP server 'world' already connected";
  const handlers: Record<string, McpHandler> = {};
  for (const draft of characterToolDrafts) {
    const toolName = draft.name;
    handlers[toolName] = async (args) => {
      const response = await client.call("agent", toolName, worldArgs(args), boundAgentId());
      return JSON.stringify(response);
    };
  }
  return mcpRegistry.addServer("world", characterToolDrafts, handlers);
}
