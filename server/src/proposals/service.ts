import { z } from "zod";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  ERROR_CODES,
  type MandateView,
  type Proposal,
  type ProposalInput,
  type ProposalStatus,
  centsToDollars,
  dollarsToCents,
  hasAtMostTwoDecimals,
} from "@leash/shared";
import { newId } from "../ids.js";
import { AppError } from "../http/errors.js";
import { getMandate } from "../mandate/storage.js";
import { writeAudit } from "../audit/storage.js";
import { evaluate } from "../policy/evaluate.js";
import { getSpent } from "./spent.js";
import { saveProposal } from "./storage.js";
import * as paymentStub from "./payment-stub.js";

let currentDb: DatabaseType | null = null;
let currentSigningSecret: string | null = null;

export function initProposalService(
  db: DatabaseType,
  signingSecret?: string,
): void {
  currentDb = db;
  currentSigningSecret = signingSecret ?? null;
}

const nonBlankString = (fieldName: string) =>
  z
    .string({ required_error: `${fieldName} is required` })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, {
      message: `${fieldName} must not be empty`,
    });

const addressSchema = z.object({
  name: nonBlankString("shipTo.name"),
  line1: nonBlankString("shipTo.line1"),
  city: nonBlankString("shipTo.city"),
  region: nonBlankString("shipTo.region"),
  postalCode: nonBlankString("shipTo.postalCode"),
  country: nonBlankString("shipTo.country"),
});

const proposalItemSchema = z.object({
  productId: nonBlankString("productId"),
  title: nonBlankString("title"),
  merchant: nonBlankString("merchant"),
  category: nonBlankString("category"),
  unitPrice: z
    .number({ required_error: "unitPrice is required" })
    .refine((n) => Number.isFinite(n) && n > 0 && hasAtMostTwoDecimals(n), {
      message:
        "unitPrice must be a positive finite number with at most 2 decimal places",
    }),
  quantity: z
    .number({ required_error: "quantity is required" })
    .refine((n) => Number.isInteger(n) && n >= 1, {
      message: "quantity must be a whole number of at least 1",
    }),
  url: nonBlankString("url"),
});

const proposalInputSchema = z.object({
  items: z.array(proposalItemSchema).min(1, "Items must not be empty"),
  shipTo: addressSchema,
  currency: nonBlankString("currency"),
  agentReasoning: z.string({ required_error: "agentReasoning is required" }),
  sourceUrls: z.array(z.string(), {
    required_error: "sourceUrls is required",
  }),
});

export async function submitProposal(input: ProposalInput): Promise<Proposal> {
  const parseResult = proposalInputSchema.safeParse(input);
  if (!parseResult.success) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      parseResult.error.errors.map((e) => e.message).join("; "),
    );
  }

  if (!currentDb) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      "Proposal service is not initialized",
    );
  }

  if (!currentSigningSecret) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      "MANDATE_SIGNING_SECRET is not configured",
    );
  }

  const mandate = getMandate(currentDb);
  if (!mandate) {
    throw new AppError(ERROR_CODES.NO_MANDATE, "No mandate found");
  }

  const validated = parseResult.data;

  const totalCents = validated.items.reduce(
    (sum, item) => sum + dollarsToCents(item.unitPrice) * item.quantity,
    0,
  );
  const total = centsToDollars(totalCents);
  const spent = getSpent(currentDb);

  const policy = evaluate(
    validated as unknown as ProposalInput,
    mandate,
    {
      spent,
      now: new Date(),
      signingSecret: currentSigningSecret,
    },
  );

  let status: ProposalStatus;
  if (policy.decision === "block") {
    status = "blocked";
  } else if (policy.decision === "ask") {
    status = "needs_approval";
  } else {
    status = "approved";
  }

  const id = newId("prop_");
  const createdAt = new Date().toISOString();

  const proposal: Proposal = {
    id,
    createdAt,
    total,
    status,
    items: validated.items,
    shipTo: validated.shipTo,
    currency: validated.currency as "USD",
    agentReasoning: validated.agentReasoning,
    sourceUrls: validated.sourceUrls,
    policy,
  };

  saveProposal(currentDb, proposal);

  const itemSummary = proposal.items
    .map((i) => `${i.quantity}x ${i.title}`)
    .join(", ");

  writeAudit(currentDb, {
    proposalId: proposal.id,
    event: "proposal_received",
    summary: itemSummary,
    amount: proposal.total,
    details: {
      items: proposal.items,
      shipTo: proposal.shipTo,
    },
  });

  writeAudit(currentDb, {
    proposalId: proposal.id,
    event: "policy_decision",
    summary: `Policy decision: ${policy.decision}`,
    amount: proposal.total,
    decision: policy.decision,
    details: {
      results: policy.results,
    },
  });

  if (status === "approved") {
    await paymentStub.startPayment(proposal);
  }

  return proposal;
}

export function getMandateView(): MandateView | null {
  if (!currentDb) {
    return null;
  }
  const mandate = getMandate(currentDb);
  if (!mandate) {
    return null;
  }
  const spent = getSpent(currentDb);
  const remaining = centsToDollars(
    dollarsToCents(mandate.totalBudget) - dollarsToCents(spent),
  );
  const { signature: _sig, ...mandateWithoutSig } = mandate;
  return {
    ...mandateWithoutSig,
    spent,
    remaining,
  };
}
