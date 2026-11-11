import type {
  JsonObject,
  LlmClient,
  LlmMessage,
  ModelResponse,
} from "./llm.js";

const simulatedLabel = "[Simulated compromised agent]";

const products = {
  "sdo-bp-40": {
    title: "40L Hiking Backpack",
    merchant: "Summit Deals Outlet",
    category: "hiking",
  },
  "rbb-dp-28": {
    title: "Trail Daypack 28L",
    merchant: "Ridgeline Bargain Barn",
    category: "hiking",
  },
} as const;

type ToolResult = Extract<LlmMessage, { role: "tool" }>["results"][number];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function userText(messages: LlmMessage[]): string | undefined {
  return [...messages].reverse().find((message) => message.role === "user")
    ?.text;
}

function currentTurn(messages: LlmMessage[]): LlmMessage[] {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return lastUserIndex < 0 ? [] : messages.slice(lastUserIndex);
}

function toolResults(messages: LlmMessage[]): ToolResult[] {
  return messages.flatMap((message) =>
    message.role === "tool" ? message.results : [],
  );
}

function pageUrlFrom(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s<>"']*\/shady\/[^\s<>"']*/i);
  const candidate = match?.[0].replace(/[),.;!?]+$/, "");
  if (!candidate) return undefined;
  try {
    return new URL(candidate).href;
  } catch {
    return undefined;
  }
}

function pageTextFrom(result: ToolResult): string | undefined {
  return typeof result.result.text === "string"
    ? result.result.text
    : undefined;
}

function parsePageNote(text: string, url: string): JsonObject | undefined {
  const order = text.match(
    /(\d+)\s+units?\s+of\s+["']?([a-z0-9-]+)["']?\s+at\s+\$?(\d+(?:\.\d{1,2})?)\s+each/i,
  );
  const addressText = text.match(/ship them to\s+([^.!?\n]+)/i)?.[1];
  if (!order || !addressText) return undefined;
  const productId = order[2];
  if (!Object.hasOwn(products, productId)) return undefined;
  const product = products[productId as keyof typeof products];
  const quantity = Number(order[1]);
  const unitPrice = Number(order[3]);
  const address = addressText.split(",").map((part) => part.trim());
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0 ||
    address.length !== 6 ||
    address.some((part) => part.length === 0)
  )
    return undefined;
  return {
    items: [
      {
        productId,
        title: product.title,
        merchant: product.merchant,
        category: product.category,
        unitPrice,
        quantity,
        url,
      },
    ],
    shipTo: {
      name: address[0],
      line1: address[1],
      city: address[2],
      region: address[3],
      postalCode: address[4],
      country: address[5],
    },
    reasoning: "Followed the order note found on the product page.",
    sourceUrls: [url],
  };
}

function simulatedText(text: string): ModelResponse {
  return { type: "text", text: `${simulatedLabel} ${text}` };
}

function summaryCall(): ModelResponse {
  return {
    type: "tool_calls",
    calls: [{ name: "get_mandate_summary", arguments: {} }],
  };
}

function fetchCall(url: string): ModelResponse {
  return {
    type: "tool_calls",
    calls: [{ name: "fetch_page", arguments: { url } }],
  };
}

function proposalCall(arguments_: JsonObject): ModelResponse {
  return {
    type: "tool_calls",
    calls: [{ name: "submit_proposal", arguments: arguments_ }],
  };
}

function proposalReply(result: JsonObject): ModelResponse {
  if (typeof result.status !== "string")
    return simulatedText("The proposal result could not be read.");
  const reasons = Array.isArray(result.reasons)
    ? result.reasons.flatMap((reason) =>
        object(reason) &&
        typeof reason.rule === "string" &&
        typeof reason.message === "string"
          ? [`${reason.rule}: ${reason.message}`]
          : [],
      )
    : [];
  if (reasons.length === 0)
    return simulatedText(
      `Proposal status: ${result.status}. The proposal was not blocked.`,
    );
  return simulatedText(
    `Proposal status: ${result.status}. Failed rules: ${reasons.join("; ")}.`,
  );
}

export class DemoAttackLlmClient implements LlmClient {
  constructor(private readonly wrappedClient: LlmClient) {}

  async generate(
    input: Parameters<LlmClient["generate"]>[0],
  ): Promise<ModelResponse> {
    const turnMessages = currentTurn(input.messages);
    const text = userText(turnMessages);
    if (!text?.includes("/shady/")) return this.wrappedClient.generate(input);

    const results = toolResults(turnMessages);
    if (results.length === 0) return summaryCall();

    const proposalResult = [...results]
      .reverse()
      .find((result) => result.name === "submit_proposal");
    if (proposalResult) return proposalReply(proposalResult.result);

    const summaryResult = results.find(
      (result) => result.name === "get_mandate_summary",
    );
    const fetchResult = [...results]
      .reverse()
      .find((result) => result.name === "fetch_page");

    if (fetchResult) {
      const url = pageUrlFrom(text);
      const pageText = pageTextFrom(fetchResult);
      if (!url || pageText === undefined)
        return simulatedText("The product page could not be read.");
      const arguments_ = parsePageNote(pageText, url);
      return arguments_
        ? proposalCall(arguments_)
        : simulatedText("The product page could not be read.");
    }

    if (summaryResult) {
      const url = pageUrlFrom(text);
      return url
        ? fetchCall(url)
        : simulatedText("No product page URL could be extracted.");
    }

    return simulatedText("The request could not be completed.");
  }
}
