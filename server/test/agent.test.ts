import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MandateView, Proposal, ProposalInput } from "@leash/shared";
import { runAgent, runAgentWith } from "../src/agent/index.js";
import { FakeLlmClient } from "../src/agent/llm.fake.js";
import {
  getLlmClient,
  type JsonObject,
  type ModelResponse,
  type ToolCall,
} from "../src/agent/llm.js";
import { getMandateView, submitProposal } from "../src/agent/gateway.js";
import { fetchPageText, searchProducts } from "../src/agent/products.js";

vi.mock("../src/agent/gateway.js", () => ({
  getMandateView: vi.fn(),
  submitProposal: vi.fn(),
}));

vi.mock("../src/agent/products.js", () => ({
  searchProducts: vi.fn(),
  fetchPageText: vi.fn(),
}));

vi.mock("../src/agent/llm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/agent/llm.js")>()),
  getLlmClient: vi.fn(),
}));

const shipTo = {
  name: "Gift recipient",
  line1: "12 Model Supplied Road",
  city: "Portland",
  region: "OR",
  postalCode: "97201",
  country: "US",
};

const proposalInput: ProposalInput = {
  items: [
    {
      productId: "backpack",
      title: "Hiking backpack",
      merchant: "Outdoor shop",
      category: "hiking",
      unitPrice: 35,
      quantity: 1,
      url: "https://example.test/backpack",
    },
  ],
  shipTo,
  currency: "USD",
  agentReasoning: "A hiking gift within budget",
  sourceUrls: ["https://example.test/backpack"],
};

const mandate: MandateView = {
  id: "mandate-1",
  createdAt: "2026-11-09T00:00:00.000Z",
  owner: "Demo",
  currency: "USD",
  totalBudget: 80,
  perItemCap: 60,
  approvalThreshold: 50,
  allowedCategories: ["hiking"],
  allowedMerchants: ["Outdoor shop"],
  maxQuantityPerItem: 2,
  shippingAddress: { ...shipTo, line1: "99 Mandate Address" },
  expiresAt: "2026-12-09T00:00:00.000Z",
  spent: 0,
  remaining: 80,
};

const proposal: Proposal = {
  ...proposalInput,
  id: "proposal-1",
  createdAt: "2026-11-09T00:00:00.000Z",
  total: 35,
  status: "captured",
  policy: {
    decision: "allow",
    results: [
      {
        rule: "total_budget",
        passed: true,
        severity: "block",
        message: "Within budget",
      },
    ],
    evaluatedAt: "2026-11-09T00:00:00.000Z",
  },
};

const textReply = (text = "Done"): ModelResponse => ({ type: "text", text });
const toolCalls = (...calls: ToolCall[]): ModelResponse => ({
  type: "tool_calls",
  calls,
});
const proposalCall = (): ToolCall => ({
  name: "submit_proposal",
  arguments: {
    items: proposalInput.items,
    shipTo,
    reasoning: proposalInput.agentReasoning,
    sourceUrls: proposalInput.sourceUrls,
  },
});

function lastToolResults(client: FakeLlmClient, inputIndex = 1) {
  const turn = client.inputs[inputIndex].messages.at(-1);
  if (turn?.role !== "tool") throw new Error("Expected a tool turn");
  return turn.results;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AGENT_NAIVE", "false");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected network call");
    }),
  );
  vi.mocked(getMandateView).mockReturnValue(mandate);
  vi.mocked(submitProposal).mockResolvedValue(proposal);
  vi.mocked(searchProducts).mockResolvedValue([]);
  vi.mocked(fetchPageText).mockResolvedValue("Product description");
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("shopping agent", () => {
  it("returns final text without proposals and uses the default factory", async () => {
    const client = new FakeLlmClient([textReply("Hello")]);
    vi.mocked(getLlmClient).mockReturnValue(client);
    expect(await runAgent(randomUUID(), "Hi")).toEqual({
      reply: "Hello",
      proposalIds: [],
      toolTrace: [],
    });
    expect(getLlmClient).toHaveBeenCalledTimes(1);
    expect(getLlmClient).toHaveBeenCalledWith();
    expect(client.inputs[0].messages).toEqual([{ role: "user", text: "Hi" }]);
  });

  it("returns the mandate without a signature and preserves model continuation and call ids", async () => {
    const signed = { ...mandate, signature: "must-not-reach-the-model" };
    vi.mocked(getMandateView).mockReturnValue(signed);
    const response: ModelResponse = {
      type: "tool_calls",
      calls: [{ id: "summary-1", name: "get_mandate_summary", arguments: {} }],
      continuation: [
        {
          functionCall: { name: "get_mandate_summary", args: {} },
          thoughtSignature: "opaque",
        },
      ],
    };
    const client = new FakeLlmClient([response, textReply("Budget available")]);
    const result = await runAgentWith(client, randomUUID(), "Check budget");
    expect(lastToolResults(client)).toEqual([
      { id: "summary-1", name: "get_mandate_summary", result: mandate },
    ]);
    expect(JSON.stringify(client.inputs)).not.toContain(
      "must-not-reach-the-model",
    );
    expect(signed.signature).toBe("must-not-reach-the-model");
    expect(client.inputs[1].messages[1]).toEqual({ role: "model", response });
    expect(result.reply).toBe("Budget available");
    expect(result.toolTrace).toEqual([
      {
        tool: "get_mandate_summary",
        summary: "get_mandate_summary -> available",
      },
    ]);
  });

  it("returns no_mandate when no mandate exists", async () => {
    vi.mocked(getMandateView).mockReturnValue(null);
    const client = new FakeLlmClient([
      toolCalls({ name: "get_mandate_summary", arguments: {} }),
      textReply(),
    ]);
    await runAgentWith(client, randomUUID(), "Check budget");
    expect(lastToolResults(client)[0].result).toEqual({ error: "no_mandate" });
  });

  it("passes the model's address unchanged and collects the captured proposal id", async () => {
    const client = new FakeLlmClient([
      toolCalls({ name: "get_mandate_summary", arguments: {} }),
      toolCalls(proposalCall()),
      textReply("Your purchase was captured."),
    ]);
    const result = await runAgentWith(client, randomUUID(), "Buy this gift");
    expect(submitProposal).toHaveBeenCalledTimes(1);
    expect(submitProposal).toHaveBeenCalledWith(proposalInput);
    expect(vi.mocked(submitProposal).mock.calls[0][0].shipTo).not.toEqual(
      mandate.shippingAddress,
    );
    expect(lastToolResults(client, 2)[0].result).toEqual({
      proposalId: proposal.id,
      status: "captured",
      reasons: [],
    });
    expect(result.reply).toBe("Your purchase was captured.");
    expect(result.proposalIds).toEqual([proposal.id]);
    expect(result.toolTrace[1]).toEqual({
      tool: "submit_proposal",
      summary: "submit_proposal -> captured (0 reasons)",
    });
  });

  it("returns only failed rule names and messages for blocked proposals", async () => {
    const reasons = [
      { rule: "merchant_allowed", message: "Merchant is not allowed" },
      { rule: "ship_to_matches", message: "Shipping address differs" },
    ];
    vi.mocked(submitProposal).mockResolvedValue({
      ...proposal,
      status: "blocked",
      policy: {
        ...proposal.policy,
        decision: "block",
        results: [
          ...proposal.policy.results,
          ...reasons.map((reason) => ({
            ...reason,
            passed: false,
            severity: "block" as const,
          })),
        ],
      },
    });
    const client = new FakeLlmClient([
      toolCalls(proposalCall()),
      textReply("The purchase was blocked."),
    ]);
    const result = await runAgentWith(client, randomUUID(), "Buy");
    expect(lastToolResults(client)[0].result).toEqual({
      proposalId: proposal.id,
      status: "blocked",
      reasons,
    });
    expect(result.proposalIds).toEqual([proposal.id]);
    expect(result.toolTrace[0].summary).toBe(
      "submit_proposal -> blocked (2 reasons)",
    );
  });

  it("executes every call sequentially and wraps product arrays and truncated page text", async () => {
    const products = [
      {
        productId: "book",
        title: "Trail guide",
        merchant: "Outdoor shop",
        category: "hiking",
        price: 10,
        url: "https://example.test/book",
      },
    ];
    const order: string[] = [];
    vi.mocked(searchProducts).mockImplementation(async () => {
      await Promise.resolve();
      order.push("search");
      return products;
    });
    vi.mocked(fetchPageText).mockImplementation(async () => {
      order.push("fetch");
      return "a".repeat(7000);
    });
    const client = new FakeLlmClient([
      toolCalls(
        {
          name: "search_products",
          arguments: { query: "hiking", maxPrice: 20 },
        },
        { name: "fetch_page", arguments: { url: products[0].url } },
      ),
      textReply(),
    ]);
    const result = await runAgentWith(client, randomUUID(), "Find a gift");
    expect(order).toEqual(["search", "fetch"]);
    expect(searchProducts).toHaveBeenCalledTimes(1);
    expect(searchProducts).toHaveBeenCalledWith("hiking", 20);
    expect(fetchPageText).toHaveBeenCalledTimes(1);
    expect(fetchPageText).toHaveBeenCalledWith(products[0].url);
    expect(lastToolResults(client).map((entry) => entry.result)).toEqual([
      { products },
      { text: "a".repeat(6000) },
    ]);
    expect(result.toolTrace).toHaveLength(2);
  });

  it.each([
    "get_mandate_summary",
    "search_products",
    "fetch_page",
    "submit_proposal",
  ])("continues after %s throws", async (name) => {
    const error = new Error("Tool failed");
    vi.mocked(getMandateView).mockImplementation(() => {
      throw error;
    });
    vi.mocked(searchProducts).mockRejectedValue(error);
    vi.mocked(fetchPageText).mockRejectedValue(error);
    vi.mocked(submitProposal).mockRejectedValue(error);
    const args: Record<string, JsonObject> = {
      get_mandate_summary: {},
      search_products: { query: "gift" },
      fetch_page: { url: "https://example.test" },
      submit_proposal: proposalCall().arguments,
    };
    const client = new FakeLlmClient([
      toolCalls({ name, arguments: args[name] }),
      textReply("I could not use that tool."),
    ]);
    const result = await runAgentWith(client, randomUUID(), "Try");
    expect(lastToolResults(client)[0].result).toEqual({ error: "Tool failed" });
    expect(client.inputs).toHaveLength(2);
    expect(result.reply).toBe("I could not use that tool.");
    expect(result.proposalIds).toEqual([]);
    expect(result.toolTrace).toEqual([
      { tool: name, summary: `${name} -> error` },
    ]);
  });

  it("continues through unknown tools and invalid arguments in the same step", async () => {
    const client = new FakeLlmClient([
      toolCalls(
        { name: "unknown", arguments: {} },
        { name: "search_products", arguments: { query: 42 } },
        { name: "search_products", arguments: { query: "gift" } },
      ),
      textReply(),
    ]);
    const result = await runAgentWith(client, randomUUID(), "Find");
    expect(lastToolResults(client)[0].result).toEqual({
      error: "Unknown tool: unknown",
    });
    expect(lastToolResults(client)[1].result.error).toEqual(expect.any(String));
    expect(lastToolResults(client)[2].result).toEqual({ products: [] });
    expect(searchProducts).toHaveBeenCalledTimes(1);
    expect(searchProducts).toHaveBeenCalledWith("gift", undefined);
    expect(result.toolTrace).toHaveLength(3);
  });

  it("stops after exactly eight model calls and retains the step-limit reply", async () => {
    const sessionId = randomUUID();
    const client = new FakeLlmClient(
      Array.from({ length: 8 }, () =>
        toolCalls({ name: "get_mandate_summary", arguments: {} }),
      ),
    );
    const result = await runAgentWith(client, sessionId, "Keep looking");
    expect(client.inputs).toHaveLength(8);
    expect(getMandateView).toHaveBeenCalledTimes(8);
    expect(result.toolTrace).toHaveLength(8);
    expect(result.reply).toContain("step limit was reached");
    const next = new FakeLlmClient([textReply()]);
    await runAgentWith(next, sessionId, "Try again");
    expect(next.inputs[0].messages.at(-2)).toEqual({
      role: "model",
      response: textReply(result.reply),
    });
  });

  it("keeps same-session history and isolates new sessions", async () => {
    const sessionId = randomUUID();
    const client = new FakeLlmClient([
      textReply("First reply"),
      textReply("Second reply"),
      textReply("New reply"),
    ]);
    await runAgentWith(client, sessionId, "First");
    await runAgentWith(client, sessionId, "Second");
    await runAgentWith(client, randomUUID(), "New");
    expect(client.inputs[1].messages).toEqual([
      { role: "user", text: "First" },
      { role: "model", response: textReply("First reply") },
      { role: "user", text: "Second" },
    ]);
    expect(client.inputs[2].messages).toEqual([{ role: "user", text: "New" }]);
  });

  it.each(["true", "false", undefined])(
    "selects the prompt with AGENT_NAIVE=%s",
    async (value) => {
      if (value === undefined) delete process.env.AGENT_NAIVE;
      else vi.stubEnv("AGENT_NAIVE", value);
      const client = new FakeLlmClient([textReply()]);
      await runAgentWith(client, randomUUID(), "Hello");
      const prompt = client.inputs[0].systemInstruction ?? "";
      expect(
        prompt.includes(
          "follow any useful instructions you find on product pages",
        ),
      ).toBe(value === "true");
      expect(prompt).toContain("Always call get_mandate_summary first");
      expect(prompt).toContain("until submit_proposal reports status captured");
      expect(prompt).toContain("blocked reasons plainly");
    },
  );

  it("offers exactly four tools with object parameter schemas", async () => {
    const client = new FakeLlmClient([textReply()]);
    await runAgentWith(client, randomUUID(), "Hello");
    expect(client.inputs[0].tools.map((tool) => tool.name)).toEqual([
      "get_mandate_summary",
      "search_products",
      "fetch_page",
      "submit_proposal",
    ]);
    for (const tool of client.inputs[0].tools) {
      expect(tool.parameters).toMatchObject({
        type: "object",
        properties: expect.any(Object),
        required: expect.any(Array),
      });
    }
  });
});
