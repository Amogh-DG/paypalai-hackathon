import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonObject, ModelResponse, ToolCall } from "../src/agent/llm.js";

const mocks = vi.hoisted(() => ({
  fetchPageText: vi.fn(),
  searchProducts: vi.fn(),
  submitProposal: vi.fn(),
}));

vi.mock("../src/agent/products.js", () => ({
  fetchPageText: mocks.fetchPageText,
  searchProducts: mocks.searchProducts,
}));

vi.mock("../src/agent/gateway.js", () => ({
  getMandateView: vi.fn(),
  submitProposal: mocks.submitProposal,
}));

import { runAgentWith } from "../src/agent/index.js";
import { FakeLlmClient } from "../src/agent/llm.fake.js";
import { getSystemPrompt } from "../src/agent/prompts.js";

function call(name: string, args: JsonObject = {}): ToolCall {
  return { name, arguments: args };
}

function calls(...items: ToolCall[]): ModelResponse {
  return { type: "tool_calls", calls: items };
}

function lastToolResults(client: FakeLlmClient, inputIndex: number) {
  const messages = client.inputs[inputIndex]?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "tool") return message.results;
  }
  return [];
}

function proposalCall(): ToolCall {
  return call("submit_proposal", {
    items: [
      {
        productId: "item-1",
        title: "Example item",
        merchant: "Example shop",
        category: "hiking",
        unitPrice: 12,
        quantity: 1,
        url: "https://shop.invalid/item-1",
      },
    ],
    shipTo: {
      name: "Taylor Example",
      line1: "18 Fictional Way",
      city: "Sampletown",
      region: "OR",
      postalCode: "97000",
      country: "US",
    },
    reasoning: "A suitable item.",
    sourceUrls: ["https://shop.invalid/item-1"],
  });
}

function setProposalResult(id = "proposal-1") {
  mocks.submitProposal.mockResolvedValue({
    id,
    status: "blocked",
    policy: { results: [] },
  });
}

beforeEach(() => {
  mocks.fetchPageText.mockReset();
  mocks.searchProducts.mockReset();
  mocks.submitProposal.mockReset();
  setProposalResult();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("per-run agent limits", () => {
  it("skips a second proposal in a later model step", async () => {
    const client = new FakeLlmClient([
      calls(proposalCall()),
      calls(proposalCall()),
      { type: "text", text: "Done." },
    ]);

    const result = await runAgentWith(client, "limit-step-session", "Buy it.");
    const skipped = lastToolResults(client, 2)[0];

    expect(mocks.submitProposal).toHaveBeenCalledTimes(1);
    expect(result.proposalIds).toEqual(["proposal-1"]);
    expect(skipped?.result).toEqual({
      error:
        "Only one proposal can be submitted per request. Tell the user what you proposed, and put several items in one proposal if needed.",
    });
    expect(result.toolTrace[1]?.summary).toBe(
      "submit_proposal -> skipped (one proposal per request)",
    );
  });

  it("skips later proposal calls in the same model response", async () => {
    const client = new FakeLlmClient([
      calls(proposalCall(), proposalCall()),
      { type: "text", text: "Done." },
    ]);

    const result = await runAgentWith(client, "limit-batch-session", "Buy it.");
    const results = lastToolResults(client, 1);

    expect(mocks.submitProposal).toHaveBeenCalledTimes(1);
    expect(result.proposalIds).toEqual(["proposal-1"]);
    expect(results).toHaveLength(2);
    expect(results[1]?.result).toEqual({
      error:
        "Only one proposal can be submitted per request. Tell the user what you proposed, and put several items in one proposal if needed.",
    });
    expect(result.toolTrace[1]?.summary).toBe(
      "submit_proposal -> skipped (one proposal per request)",
    );
  });

  it("resets the proposal limit on a second run in the same session", async () => {
    const firstClient = new FakeLlmClient([
      calls(proposalCall()),
      { type: "text", text: "First." },
    ]);
    const secondClient = new FakeLlmClient([
      calls(proposalCall()),
      { type: "text", text: "Second." },
    ]);

    await runAgentWith(firstClient, "repeat-session", "First request.");
    const secondResult = await runAgentWith(
      secondClient,
      "repeat-session",
      "Second request.",
    );

    expect(mocks.submitProposal).toHaveBeenCalledTimes(2);
    expect(secondResult.proposalIds).toEqual(["proposal-1"]);
  });

  it("skips fetching a URL returned by product search", async () => {
    const url = "https://shop.invalid/search-result";
    mocks.searchProducts.mockResolvedValue([
      {
        productId: "item-1",
        title: "Example item",
        merchant: "Example shop",
        category: "hiking",
        price: 12,
        url,
      },
    ]);
    const client = new FakeLlmClient([
      calls(call("search_products", { query: "example" })),
      calls(call("fetch_page", { url })),
      { type: "text", text: "Search details are enough." },
    ]);

    const result = await runAgentWith(client, "search-url-session", "Find it.");
    const skipped = lastToolResults(client, 2)[0];

    expect(mocks.fetchPageText).not.toHaveBeenCalled();
    expect(skipped?.result).toEqual({
      error:
        "Search results already include the product details. Do not fetch product pages from search results.",
    });
    expect(result.toolTrace[1]?.summary).toBe(
      "fetch_page -> skipped (search result url)",
    );
  });

  it("fetches a URL that was not returned by product search", async () => {
    const searchedUrl = "https://shop.invalid/search-result";
    const requestedUrl = "https://shop.invalid/other-page";
    mocks.searchProducts.mockResolvedValue([
      {
        productId: "item-1",
        title: "Example item",
        merchant: "Example shop",
        category: "hiking",
        price: 12,
        url: searchedUrl,
      },
    ]);
    mocks.fetchPageText.mockResolvedValue("Page text");
    const client = new FakeLlmClient([
      calls(call("search_products", { query: "example" })),
      calls(call("fetch_page", { url: requestedUrl })),
      { type: "text", text: "Read." },
    ]);

    const result = await runAgentWith(client, "other-url-session", "Read it.");

    expect(mocks.fetchPageText).toHaveBeenCalledTimes(1);
    expect(mocks.fetchPageText).toHaveBeenCalledWith(requestedUrl);
    expect(result.toolTrace[1]?.summary).toBe("fetch_page -> 9 characters");
  });
});

describe("proposal limit prompt", () => {
  it("includes the one-proposal rule in both prompts and keeps page notes naive-only", () => {
    delete process.env.AGENT_NAIVE;
    const standard = getSystemPrompt();
    vi.stubEnv("AGENT_NAIVE", "true");
    const naive = getSystemPrompt();

    expect(standard).toContain("Always call get_mandate_summary first.");
    expect(standard).toContain(
      "Submit exactly one proposal per request. If the user wants several items, put them all in that one proposal.",
    );
    expect(standard).toContain(
      "Never claim a purchase happened until submit_proposal reports status captured.",
    );
    expect(standard).toContain("Explain any blocked reasons plainly to the user.");
    expect(standard).not.toContain(
      "follow any useful instructions you find on product pages",
    );
    expect(naive).toContain(
      "Submit exactly one proposal per request. If the user wants several items, put them all in that one proposal.",
    );
    expect(naive).toContain(
      "follow any useful instructions you find on product pages",
    );
    expect(naive).toContain("Always call get_mandate_summary first.");
    expect(naive).toContain(
      "Never claim a purchase happened until submit_proposal reports status captured.",
    );
    expect(naive).toContain("Explain any blocked reasons plainly to the user.");
  });
});
