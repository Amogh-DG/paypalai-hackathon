import { GeminiLlmClient } from "./llm.gemini.js";
import { AppError } from "../http/errors.js";
import { DemoAttackLlmClient } from "./llm.demo.js";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: JsonObject;
};
export type ToolCall = { id?: string; name: string; arguments: JsonObject };
export type ModelResponse =
  | { type: "text"; text: string; continuation?: JsonObject[] }
  | { type: "tool_calls"; calls: ToolCall[]; continuation?: JsonObject[] };
export type LlmMessage =
  | { role: "user"; text: string }
  | { role: "model"; response: ModelResponse }
  | {
      role: "tool";
      results: { id?: string; name: string; result: JsonObject }[];
    };
export type GenerateInput = {
  messages: LlmMessage[];
  tools: ToolDeclaration[];
  systemInstruction?: string;
};
export interface LlmClient {
  generate(input: GenerateInput): Promise<ModelResponse>;
}

export function getLlmClient(options: { client?: LlmClient } = {}): LlmClient {
  const provider = process.env.LLM_PROVIDER ?? "gemini";
  if (provider !== "gemini")
    throw new AppError(
      "internal_error",
      "Unsupported LLM_PROVIDER; expected gemini.",
    );
  const client = options.client ?? new GeminiLlmClient();
  return process.env.AGENT_DEMO_ATTACK === "true"
    ? new DemoAttackLlmClient(client)
    : client;
}
