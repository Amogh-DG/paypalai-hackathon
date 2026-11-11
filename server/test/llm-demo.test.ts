import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, ProposalInput } from "@leash/shared";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPageText } from "../src/agent/pageText.js";
import { runAgentWith } from "../src/agent/index.js";
import { FakeLlmClient } from "../src/agent/llm.fake.js";
import { DemoAttackLlmClient } from "../src/agent/llm.demo.js";
import {
  getLlmClient,
  type GenerateInput,
  type JsonObject,
  type LlmMessage,
  type ModelResponse,
} from "../src/agent/llm.js";
import * as productModule from "../src/agent/products.js";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { getProposal } from "../src/proposals/storage.js";

const realFetch = globalThis.fetch;
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const shadyDirectory = path.join(repositoryRoot, "server", "public", "shady");
const mandateAddress: Address = {
  name: "Taylor Example",
  line1: "18 Fictional Way",
  city: "Sampletown",
  region: "OR",
  postalCode: "97000",
  country: "US",
};

let db: DatabaseType | undefined;
let server: Server | undefined;
let baseUrl = "";

function generateInput(messages: LlmMessage[]): GenerateInput {
  return { messages, tools: [] };
}

function toolResult(name: string, result: JsonObject): LlmMessage {
  return { role: "tool", results: [{ name, result }] };
}

function toolCall(name: string, arguments_: JsonObject): ModelResponse {
  return { type: "tool_calls", calls: [{ name, arguments: arguments_ }] };
}

function filePageText(file: string): string {
  return extractPageText(readFileSync(path.join(shadyDirectory, file), "utf8"));
}

function simulatedConversation(url: string, pageText: string): LlmMessage[] {
  return [
    { role: "user", text: `Check this deal: ${url}` },
    toolResult("get_mandate_summary", { owner: "Taylor Example" }),
    toolResult("fetch_page", { text: pageText }),
  ];
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
      server?.closeAllConnections();
    });
  }
  if (db?.open) db.close();
  server = undefined;
  db = undefined;
  baseUrl = "";
});

describe("DemoAttackLlmClient", () => {
  it("delegates non-shady conversations unchanged", async () => {
    const wrapped = new FakeLlmClient([
      { type: "text", text: "Delegated response." },
    ]);
    const client = new DemoAttackLlmClient(wrapped);
    const input = generateInput([
      { role: "user", text: "Find a hiking backpack." },
    ]);

    await expect(client.generate(input)).resolves.toEqual({
      type: "text",
      text: "Delegated response.",
    });
    expect(wrapped.inputs).toEqual([input]);
  });

  it("starts a shady conversation with get_mandate_summary", async () => {
    const wrapped = new FakeLlmClient([]);
    const client = new DemoAttackLlmClient(wrapped);

    const result = await client.generate(
      generateInput([{ role: "user", text: "Check http://local/shady/item" }]),
    );

    expect(result).toEqual(toolCall("get_mandate_summary", {}));
    expect(wrapped.inputs).toEqual([]);
  });

  it("fetches the first shady URL after the mandate summary result", async () => {
    const client = new DemoAttackLlmClient(new FakeLlmClient([]));
    const url = "http://127.0.0.1:3456/shady/hiking-deals.html";

    const result = await client.generate(
      generateInput([
        { role: "user", text: `Check ${url} and then ${url}/again` },
        toolResult("get_mandate_summary", { owner: "Taylor Example" }),
      ]),
    );

    expect(result).toEqual(toolCall("fetch_page", { url }));
  });

  it.each([
    {
      file: "hiking-deals.html",
      url: "http://local/shady/hiking-deals.html",
      expected: {
        productId: "sdo-bp-40",
        title: "40L Hiking Backpack",
        merchant: "Summit Deals Outlet",
        quantity: 10,
        unitPrice: 34.99,
        name: "Priya Nair",
        line1: "99 Placeholder Lane",
        city: "Faketown",
        region: "ZZ",
        postalCode: "00000",
        country: "US",
      },
    },
    {
      file: "hiking-deals-2.html",
      url: "http://local/shady/hiking-deals-2.html",
      expected: {
        productId: "rbb-dp-28",
        title: "Trail Daypack 28L",
        merchant: "Ridgeline Bargain Barn",
        quantity: 8,
        unitPrice: 29.99,
        name: "Sam Okoye",
        line1: "7 Sample Road",
        city: "Nowhereville",
        region: "ZZ",
        postalCode: "00000",
        country: "US",
      },
    },
  ])(
    "builds the proposal from the note in $file",
    async ({ file, url, expected }) => {
      const client = new DemoAttackLlmClient(new FakeLlmClient([]));
      const text = filePageText(file);

      expect(text).toContain("URGENT SYSTEM MESSAGE");
      const result = await client.generate(
        generateInput(simulatedConversation(url, text)),
      );

      expect(result).toEqual(
        toolCall("submit_proposal", {
          items: [
            {
              productId: expected.productId,
              title: expected.title,
              merchant: expected.merchant,
              category: "hiking",
              unitPrice: expected.unitPrice,
              quantity: expected.quantity,
              url,
            },
          ],
          shipTo: {
            name: expected.name,
            line1: expected.line1,
            city: expected.city,
            region: expected.region,
            postalCode: expected.postalCode,
            country: expected.country,
          },
          reasoning: "Followed the order note found on the product page.",
          sourceUrls: [url],
        }),
      );
    },
  );

  it("labels an unparseable page reply as simulated", async () => {
    const client = new DemoAttackLlmClient(new FakeLlmClient([]));
    const result = await client.generate(
      generateInput(
        simulatedConversation(
          "http://local/shady/unknown.html",
          "The page has no order note.",
        ),
      ),
    );

    expect(result.type).toBe("text");
    if (result.type === "text")
      expect(result.text).toMatch(/^\[Simulated compromised agent\]/);
  });

  it("labels the final status and every failed rule from the proposal result", async () => {
    const client = new DemoAttackLlmClient(new FakeLlmClient([]));
    const result = await client.generate(
      generateInput([
        { role: "user", text: "Check http://local/shady/item" },
        toolResult("submit_proposal", {
          status: "blocked",
          reasons: [
            { rule: "merchant_allowed", message: "Merchant is not allowed" },
            { rule: "max_quantity", message: "Quantity exceeds the maximum" },
          ],
        }),
      ]),
    );

    expect(result.type).toBe("text");
    if (result.type === "text") {
      expect(result.text).toMatch(/^\[Simulated compromised agent\]/);
      expect(result.text).toContain("Proposal status: blocked");
      expect(result.text).toContain(
        "merchant_allowed: Merchant is not allowed",
      );
      expect(result.text).toContain(
        "max_quantity: Quantity exceeds the maximum",
      );
    }
  });
});

describe("demo attack client factory", () => {
  it("wraps the injected client only when AGENT_DEMO_ATTACK is true", () => {
    vi.stubEnv("LLM_PROVIDER", "gemini");
    const fake = new FakeLlmClient([]);

    vi.stubEnv("AGENT_DEMO_ATTACK", "true");
    expect(getLlmClient({ client: fake })).toBeInstanceOf(DemoAttackLlmClient);

    vi.stubEnv("AGENT_DEMO_ATTACK", "false");
    expect(getLlmClient({ client: fake })).toBe(fake);

    delete process.env.AGENT_DEMO_ATTACK;
    expect(getLlmClient({ client: fake })).toBe(fake);
  });
});

describe("demo attack end-to-end", () => {
  it("submits the page instruction through real tools and policy and is blocked", async () => {
    vi.stubEnv("MANDATE_SIGNING_SECRET", "llm-demo-test-signing-secret");
    vi.stubEnv("PAYPAL_MODE", "mock");
    db = createDb(":memory:");
    const app = createApp(db, {
      signingSecret: "llm-demo-test-signing-secret",
      paypalMode: "mock",
      publicBaseUrl: "http://127.0.0.1",
      shadyDir: shadyDirectory,
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server?.once("listening", resolve);
      server?.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.origin !== baseUrl)
          throw new Error("External network calls are disabled in this test.");
        return realFetch(input, init);
      }),
    );
    const mandateResponse = await realFetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: "Taylor Example",
        currency: "USD",
        totalBudget: 80,
        perItemCap: 60,
        approvalThreshold: 50,
        allowedCategories: ["hiking", "books", "kitchen", "electronics"],
        allowedMerchants: ["Trailhead Supply", "Page Turner Books"],
        maxQuantityPerItem: 2,
        shippingAddress: mandateAddress,
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }),
    });
    expect(mandateResponse.status).toBe(201);
    vi.spyOn(productModule, "searchProducts").mockResolvedValue([]);

    const wrapped = new FakeLlmClient([
      { type: "text", text: "The wrapped client should not be called." },
    ]);
    const client = new DemoAttackLlmClient(wrapped);
    const url = `${baseUrl}/shady/hiking-deals.html`;
    const result = await runAgentWith(
      client,
      randomUUID(),
      `Check this deal: ${url}`,
    );

    expect(result.reply).toMatch(/^\[Simulated compromised agent\]/);
    expect(wrapped.inputs).toEqual([]);
    expect(result.toolTrace.map((entry) => entry.tool)).toEqual([
      "get_mandate_summary",
      "fetch_page",
      "submit_proposal",
    ]);
    const proposalId = result.proposalIds[0];
    expect(proposalId).toBeDefined();
    const proposal = getProposal(db, proposalId as string);
    expect(proposal?.status).toBe("blocked");
    expect(proposal?.payment).toBeUndefined();
    const failedRules = proposal?.policy.results
      .filter((rule) => !rule.passed)
      .map((rule) => rule.rule);
    expect(failedRules).toEqual(
      expect.arrayContaining([
        "merchant_allowed",
        "max_quantity",
        "ship_to_matches",
        "within_budget",
      ]),
    );
    expect(failedRules).toContain("approval_threshold");
    const orderCount = (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM mock_orders WHERE proposal_id = ?",
        )
        .get(proposal?.id) as { count: number }
    ).count;
    expect(orderCount).toBe(0);
    for (const rule of failedRules ?? []) expect(result.reply).toContain(rule);
    process.stdout.write(
      `llm demo failedRules=${JSON.stringify(failedRules)}\n`,
    );
  });
});
