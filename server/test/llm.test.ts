import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLlmClient,
  type GenerateInput,
  type ModelResponse,
} from "../src/agent/llm.js";
import { FakeLlmClient } from "../src/agent/llm.fake.js";
import { GeminiLlmClient } from "../src/agent/llm.gemini.js";

const input: GenerateInput = {
  messages: [{ role: "user", text: "Hello" }],
  tools: [],
};
const success = () =>
  Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { role: "model", parts: [{ text: "Hello back" }] },
      },
    ],
  });
const delay = vi.fn(async (_milliseconds: number) => {});

beforeEach(() => {
  vi.stubEnv("LLM_PROVIDER", "gemini");
  vi.stubEnv("LLM_MODEL", "gemini-test-model");
  vi.stubEnv("LLM_API_KEY", "test-secret-never-real");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected network call");
    }),
  );
  delay.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("LLM adapters", () => {
  it("scripts responses and records independent input snapshots", async () => {
    const responses: ModelResponse[] = [
      { type: "text", text: "first" },
      { type: "tool_calls", calls: [{ name: "search", arguments: {} }] },
    ];
    const fake = new FakeLlmClient(responses);
    expect(await fake.generate(input)).toEqual(responses[0]);
    expect(await fake.generate(input)).toEqual(responses[1]);
    expect(fake.inputs).toEqual([input, input]);
    expect(fake.inputs[0]).not.toBe(input);
    await expect(fake.generate(input)).rejects.toThrow("queue is empty");
  });
  it("defaults only an unset provider and permits explicit injection", () => {
    delete process.env.LLM_PROVIDER;
    expect(getLlmClient()).toBeInstanceOf(GeminiLlmClient);
    const fake = new FakeLlmClient([]);
    expect(getLlmClient({ client: fake })).toBe(fake);
  });
  it.each(["", "fake", "other"])(
    "rejects provider %s even with injection",
    (provider) => {
      vi.stubEnv("LLM_PROVIDER", provider);
      expect(() => getLlmClient({ client: new FakeLlmClient([]) })).toThrow(
        "Unsupported LLM_PROVIDER",
      );
    },
  );
  it("requires model and key before network access", () => {
    delete process.env.LLM_MODEL;
    expect(() => getLlmClient()).toThrow("LLM_MODEL");
    vi.stubEnv("LLM_MODEL", "gemini-test-model");
    delete process.env.LLM_API_KEY;
    expect(() => getLlmClient()).toThrow("LLM_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retries 503 twice then returns text", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(success());
    await expect(
      new GeminiLlmClient({ fetch: fetcher, delay }).generate(input),
    ).resolves.toMatchObject({ type: "text", text: "Hello back" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls).toEqual([[1000], [2000]]);
  });
  it.each([429, 500, 503])(
    "exhausts HTTP %s after three attempts",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response(null, { status }));
      await expect(
        new GeminiLlmClient({ fetch: fetcher, delay }).generate(input),
      ).rejects.toMatchObject({ code: "model_busy" });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(delay.mock.calls).toEqual([[1000], [2000]]);
    },
  );
  it("retries network errors without exposing their messages", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("test-secret-never-real"));
    const error = await new GeminiLlmClient({ fetch: fetcher, delay })
      .generate(input)
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "model_busy" });
    expect(String(error)).not.toContain("test-secret-never-real");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([400, 401])(
    "does not retry or expose response content for HTTP %s",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("test-secret-never-real", { status }));
      const error = await new GeminiLlmClient({ fetch: fetcher, delay })
        .generate(input)
        .catch((error: unknown) => error);
      expect(String(error)).toContain(`HTTP ${status}`);
      expect(String(error)).not.toContain("test-secret-never-real");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(delay).not.toHaveBeenCalled();
    },
  );
  it("maps declarations, calls and results and preserves signatures", async () => {
    vi.stubEnv("LLM_MODEL", "models/gemini-test-model");
    const parts = [
      { thought: true, text: "Internal", thoughtSignature: "opaque-text" },
      {
        functionCall: {
          id: "call-1",
          name: "search",
          args: { query: "books" },
        },
        thoughtSignature: "opaque-call",
      },
      { functionCall: { name: "summary" } },
    ];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ candidates: [{ content: { parts } }] }),
      )
      .mockResolvedValueOnce(success());
    const client = new GeminiLlmClient({ fetch: fetcher, delay });
    const tools = [
      {
        name: "search",
        description: "Search",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ];
    const response = await client.generate({
      ...input,
      tools,
      systemInstruction: "Be helpful",
    });
    expect(response).toEqual({
      type: "tool_calls",
      calls: [
        { id: "call-1", name: "search", arguments: { query: "books" } },
        { name: "summary", arguments: {} },
      ],
      continuation: parts,
    });
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent",
    );
    expect(request?.headers).toEqual({
      "Content-Type": "application/json",
      "x-goog-api-key": "test-secret-never-real",
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: "search",
              description: "Search",
              parametersJsonSchema: tools[0].parameters,
            },
          ],
        },
      ],
      systemInstruction: { parts: [{ text: "Be helpful" }] },
    });
    await client.generate({
      tools,
      messages: [
        ...input.messages,
        { role: "model", response },
        {
          role: "tool",
          results: [
            { id: "call-1", name: "search", result: { products: [] } },
            { name: "summary", result: { owner: "Demo" } },
          ],
        },
      ],
    });
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(body.contents[1]).toEqual({ role: "model", parts });
    expect(body.contents[2]).toEqual({
      role: "user",
      parts: [
        {
          functionResponse: {
            id: "call-1",
            name: "search",
            response: { products: [] },
          },
        },
        { functionResponse: { name: "summary", response: { owner: "Demo" } } },
      ],
    });
  });
  it.each([
    {},
    { candidates: [] },
    {
      candidates: [
        { finishReason: "SAFETY", content: { parts: [{ text: "blocked" }] } },
      ],
    },
    {
      candidates: [
        { content: { parts: [{ functionCall: { name: "x", args: [] } }] } },
      ],
    },
  ])("rejects malformed or blocked output", async (payload) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(payload));
    await expect(
      new GeminiLlmClient({ fetch: fetcher, delay }).generate(input),
    ).rejects.toMatchObject({ code: "internal_error" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
