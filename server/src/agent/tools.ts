import { z } from "zod";
import type { ProposalInput } from "@leash/shared";
import type { JsonObject, ToolCall, ToolDeclaration } from "./llm.js";
import { getMandateView, submitProposal } from "./gateway.js";
import { fetchPageText, searchProducts } from "./products.js";

const addressSchema = z
  .object({
    name: z.string(),
    line1: z.string(),
    city: z.string(),
    region: z.string(),
    postalCode: z.string(),
    country: z.string(),
  })
  .passthrough();

const itemSchema = z
  .object({
    productId: z.string(),
    title: z.string(),
    merchant: z.string(),
    category: z.string(),
    unitPrice: z.number(),
    quantity: z.number(),
    url: z.string(),
  })
  .passthrough();

const proposalSchema = z.object({
  items: z.array(itemSchema),
  shipTo: addressSchema,
  reasoning: z.string(),
  sourceUrls: z.array(z.string()),
});

export const toolDeclarations: ToolDeclaration[] = [
  {
    name: "get_mandate_summary",
    description: "Get the current mandate and its spent and remaining budget.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "search_products",
    description: "Search products by query and optional maximum price.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxPrice: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_page",
    description: "Read up to 6000 characters of a product page's text.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "submit_proposal",
    description:
      "Submit a USD purchase proposal for policy and payment processing.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              productId: { type: "string" },
              title: { type: "string" },
              merchant: { type: "string" },
              category: { type: "string" },
              unitPrice: { type: "number" },
              quantity: { type: "number" },
              url: { type: "string" },
            },
            required: [
              "productId",
              "title",
              "merchant",
              "category",
              "unitPrice",
              "quantity",
              "url",
            ],
          },
        },
        shipTo: {
          type: "object",
          properties: {
            name: { type: "string" },
            line1: { type: "string" },
            city: { type: "string" },
            region: { type: "string" },
            postalCode: { type: "string" },
            country: { type: "string" },
          },
          required: [
            "name",
            "line1",
            "city",
            "region",
            "postalCode",
            "country",
          ],
        },
        reasoning: { type: "string" },
        sourceUrls: { type: "array", items: { type: "string" } },
      },
      required: ["items", "shipTo", "reasoning", "sourceUrls"],
    },
  },
];

export async function executeTool(call: ToolCall): Promise<{
  result: JsonObject;
  summary: string;
  proposalId?: string;
}> {
  try {
    switch (call.name) {
      case "get_mandate_summary": {
        const view = getMandateView();
        if (view === null) {
          return {
            result: { error: "no_mandate" },
            summary: "get_mandate_summary -> no mandate",
          };
        }
        const result: JsonObject = { ...view };
        delete result.signature;
        return { result, summary: "get_mandate_summary -> available" };
      }
      case "search_products": {
        const args = z
          .object({ query: z.string(), maxPrice: z.number().optional() })
          .parse(call.arguments);
        const products = await searchProducts(args.query, args.maxPrice);
        return {
          result: { products },
          summary: `search_products -> ${products.length} products`,
        };
      }
      case "fetch_page": {
        const args = z.object({ url: z.string() }).parse(call.arguments);
        const text = (await fetchPageText(args.url)).slice(0, 6000);
        return {
          result: { text },
          summary: `fetch_page -> ${text.length} characters`,
        };
      }
      case "submit_proposal": {
        const args = proposalSchema.parse(call.arguments);
        const input: ProposalInput = {
          items: args.items,
          shipTo: args.shipTo,
          currency: "USD",
          agentReasoning: args.reasoning,
          sourceUrls: args.sourceUrls,
        };
        const proposal = await submitProposal(input);
        const reasons = proposal.policy.results
          .filter((result) => !result.passed)
          .map(({ rule, message }) => ({ rule, message }));
        return {
          result: { proposalId: proposal.id, status: proposal.status, reasons },
          proposalId: proposal.id,
          summary: `submit_proposal -> ${proposal.status} (${reasons.length} reasons)`,
        };
      }
      default:
        throw new Error(`Unknown tool: ${call.name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { result: { error: message }, summary: `${call.name} -> error` };
  }
}
