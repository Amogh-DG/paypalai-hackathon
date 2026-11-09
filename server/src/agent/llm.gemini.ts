import { AppError } from "../http/errors.js";
import type {
  GenerateInput,
  JsonObject,
  LlmClient,
  ModelResponse,
  ToolCall,
} from "./llm.js";

export type GeminiOptions = {
  fetch?: typeof globalThis.fetch;
  delay?: (milliseconds: number) => Promise<void>;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): AppError {
  return new AppError(
    "internal_error",
    "Gemini returned an invalid or unsupported response.",
  );
}

function parseResponse(value: unknown): ModelResponse {
  if (!object(value) || !Array.isArray(value.candidates))
    throw invalidResponse();
  const candidate: unknown = value.candidates[0];
  if (
    !object(candidate) ||
    !object(candidate.content) ||
    !Array.isArray(candidate.content.parts)
  )
    throw invalidResponse();
  if (candidate.finishReason !== undefined && candidate.finishReason !== "STOP")
    throw invalidResponse();
  const calls: ToolCall[] = [];
  const texts: string[] = [];
  for (const part of candidate.content.parts as unknown[]) {
    if (!object(part)) throw invalidResponse();
    if (part.functionCall !== undefined) {
      const call = part.functionCall;
      if (
        !object(call) ||
        typeof call.name !== "string" ||
        !call.name ||
        (call.args !== undefined && !object(call.args)) ||
        (call.id !== undefined && typeof call.id !== "string")
      )
        throw invalidResponse();
      calls.push({
        name: call.name,
        arguments: (call.args ?? {}) as JsonObject,
        ...(typeof call.id === "string" ? { id: call.id } : {}),
      });
    } else if (typeof part.text === "string" && part.thought !== true) {
      texts.push(part.text);
    }
  }
  const continuation = structuredClone(candidate.content.parts) as JsonObject[];
  if (calls.length) return { type: "tool_calls", calls, continuation };
  if (texts.length) return { type: "text", text: texts.join(""), continuation };
  throw invalidResponse();
}

export class GeminiLlmClient implements LlmClient {
  private readonly model: string;
  private readonly key: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly delay: (milliseconds: number) => Promise<void>;

  constructor(options: GeminiOptions = {}) {
    const model = process.env.LLM_MODEL;
    if (!model?.trim())
      throw new AppError("internal_error", "LLM_MODEL is required for Gemini.");
    const id = model.startsWith("models/") ? model.slice(7) : model;
    if (!/^[a-zA-Z0-9._-]+$/.test(id))
      throw new AppError(
        "internal_error",
        "LLM_MODEL must be a model ID or models/{model} resource name.",
      );
    const key = process.env.LLM_API_KEY;
    if (!key?.trim())
      throw new AppError(
        "internal_error",
        "LLM_API_KEY is required for Gemini.",
      );
    this.model = `models/${id}`;
    this.key = key;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.delay =
      options.delay ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async generate(input: GenerateInput): Promise<ModelResponse> {
    const contents = input.messages.map((message) => {
      if (message.role === "user")
        return { role: "user", parts: [{ text: message.text }] };
      if (message.role === "tool")
        return {
          role: "user",
          parts: message.results.map(({ name, id, result }) => ({
            functionResponse: {
              name,
              response: result,
              ...(id === undefined ? {} : { id }),
            },
          })),
        };
      const response = message.response;
      const parts =
        response.continuation ??
        (response.type === "text"
          ? [{ text: response.text }]
          : response.calls.map(({ name, id, arguments: args }) => ({
              functionCall: { name, args, ...(id === undefined ? {} : { id }) },
            })));
      return { role: "model", parts };
    });
    const body = JSON.stringify({
      contents,
      ...(input.systemInstruction === undefined
        ? {}
        : {
            systemInstruction: { parts: [{ text: input.systemInstruction }] },
          }),
      ...(input.tools.length
        ? {
            tools: [
              {
                functionDeclarations: input.tools.map(
                  ({ name, description, parameters }) => ({
                    name,
                    description,
                    parametersJsonSchema: parameters,
                  }),
                ),
              },
            ],
          }
        : {}),
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(
          `https://generativelanguage.googleapis.com/v1beta/${this.model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": this.key,
            },
            body,
          },
        );
      } catch {
        if (attempt === 2)
          throw new AppError(
            "model_busy",
            "Gemini is temporarily unavailable. Please try again.",
          );
        await this.delay(1000 * (attempt + 1));
        continue;
      }
      if ([429, 500, 503].includes(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        if (attempt === 2)
          throw new AppError(
            "model_busy",
            "Gemini is temporarily unavailable. Please try again.",
          );
        await this.delay(1000 * (attempt + 1));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new AppError(
          "internal_error",
          `Gemini request failed with HTTP ${response.status}.`,
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw invalidResponse();
      }
      return parseResponse(payload);
    }
    throw new AppError(
      "model_busy",
      "Gemini is temporarily unavailable. Please try again.",
    );
  }
}
