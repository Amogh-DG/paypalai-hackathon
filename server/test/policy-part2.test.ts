import { describe, it, expect } from "vitest";
import type { Mandate, ProposalInput } from "@leash/shared";
import { evaluate } from "../src/policy/evaluate.js";
import { signMandate } from "../src/mandate/signing.js";
import {
  validMandate,
  validProposal,
  defaultContext,
  testSigningSecret,
  baseMandateWithoutSignature,
} from "./policy-fixtures.js";

describe("policy engine rules and decision flow", () => {
  it("allows a completely valid proposal within limits", () => {
    const res = evaluate(validProposal, validMandate, defaultContext);
    expect(res.decision).toBe("allow");
    expect(res.results).toHaveLength(10);
    expect(res.results.every((r) => r.passed)).toBe(true);
  });

  it("fails signature_valid when mandate signature is invalid", () => {
    const tampered = { ...validMandate, signature: "a".repeat(64) };
    const res = evaluate(validProposal, tampered, defaultContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "signature_valid");
    expect(rule?.passed).toBe(false);
    expect(rule?.severity).toBe("block");
  });

  it("fails not_expired when evaluated after mandate expiry", () => {
    const expiredContext = {
      ...defaultContext,
      now: new Date("2027-01-01T00:00:00.000Z"),
    };
    const res = evaluate(validProposal, validMandate, expiredContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "not_expired");
    expect(rule?.passed).toBe(false);
  });

  it("fails currency_match when proposal currency differs", () => {
    const proposal = {
      ...validProposal,
      currency: "EUR" as unknown as "USD",
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "currency_match");
    expect(rule?.passed).toBe(false);
  });

  it("fails merchant_allowed when item merchant is not in allowed list", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          merchant: "Unknown Store",
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "merchant_allowed");
    expect(rule?.passed).toBe(false);
  });

  it("fails category_allowed when item category is not in allowed list", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          category: "Automotive",
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "category_allowed");
    expect(rule?.passed).toBe(false);
  });

  it("per_item_cap passes when item price is exactly at the cap", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          unitPrice: 60.0,
          quantity: 1,
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    const rule = res.results.find((r) => r.rule === "per_item_cap");
    expect(rule?.passed).toBe(true);
  });

  it("per_item_cap fails when item price is one cent above the cap", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          unitPrice: 60.01,
          quantity: 1,
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "per_item_cap");
    expect(rule?.passed).toBe(false);
    expect(rule?.severity).toBe("block");
  });

  it("max_quantity passes when quantity equals mandate maxQuantityPerItem", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          quantity: 2,
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    const rule = res.results.find((r) => r.rule === "max_quantity");
    expect(rule?.passed).toBe(true);
  });

  it("max_quantity fails when quantity is 0", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          quantity: 0,
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "max_quantity");
    expect(rule?.passed).toBe(false);
  });

  it("max_quantity fails when quantity exceeds max and names quantity and max in message", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          quantity: 10,
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "max_quantity");
    expect(rule?.passed).toBe(false);
    expect(rule?.message).toBe("Quantity 10 exceeds the maximum of 2 per item.");
  });

  it("ship_to_matches passes when address matches with mixed case and whitespace", () => {
    const proposal = {
      ...validProposal,
      shipTo: {
        name: "  JANE   DOE  ",
        line1: " 123  Trail   Way ",
        city: "PORTLAND",
        region: "or",
        postalCode: " 97201 ",
        country: "us",
      },
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    const rule = res.results.find((r) => r.rule === "ship_to_matches");
    expect(rule?.passed).toBe(true);
  });

  it("ship_to_matches fails when address differs with exact expected message", () => {
    const proposal = {
      ...validProposal,
      shipTo: {
        ...validProposal.shipTo,
        line1: "999 Rogue Street",
      },
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "ship_to_matches");
    expect(rule?.passed).toBe(false);
    expect(rule?.message).toBe("Ship-to address differs from the mandate address.");
  });

  it("within_budget passes when spent plus total is exactly equal to totalBudget", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          unitPrice: 20.0,
          quantity: 1,
        },
      ],
    };
    const context = {
      ...defaultContext,
      spent: 60.0,
    };
    const res = evaluate(proposal, validMandate, context);
    const rule = res.results.find((r) => r.rule === "within_budget");
    expect(rule?.passed).toBe(true);
  });

  it("within_budget fails when spent plus total is one cent over budget", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          unitPrice: 20.01,
          quantity: 1,
        },
      ],
    };
    const context = {
      ...defaultContext,
      spent: 60.0,
    };
    const res = evaluate(proposal, validMandate, context);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "within_budget");
    expect(rule?.passed).toBe(false);
  });

  it("approval_threshold gives allow when total is exactly 50.00", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          unitPrice: 50.0,
          quantity: 1,
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("allow");
    const rule = res.results.find((r) => r.rule === "approval_threshold");
    expect(rule?.passed).toBe(true);
  });

  it("approval_threshold gives ask when total is 50.01", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          unitPrice: 50.01,
          quantity: 1,
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("ask");
    const rule = res.results.find((r) => r.rule === "approval_threshold");
    expect(rule?.passed).toBe(false);
    expect(rule?.severity).toBe("ask");
  });

  it("handles the attack case by failing merchant_allowed, max_quantity, and ship_to_matches with block decision", () => {
    const attackProposal: ProposalInput = {
      items: [
        {
          productId: "attack-1",
          title: "Malicious Backpack",
          merchant: "ShadyDealMerchant",
          category: "Gear",
          unitPrice: 30.0,
          quantity: 10,
          url: "https://shady.example.com",
        },
      ],
      shipTo: {
        name: "Rogue Buyer",
        line1: "666 Injection Alley",
        city: "Nowhere",
        region: "XX",
        postalCode: "00000",
        country: "US",
      },
      currency: "USD",
      agentReasoning: "Tricked by prompt injection",
      sourceUrls: ["https://shady.example.com"],
    };

    const res = evaluate(attackProposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    expect(res.results).toHaveLength(10);

    const failedRuleNames = res.results.filter((r) => !r.passed).map((r) => r.rule);
    expect(failedRuleNames).toContain("merchant_allowed");
    expect(failedRuleNames).toContain("max_quantity");
    expect(failedRuleNames).toContain("ship_to_matches");

    const maxQtyRule = res.results.find((r) => r.rule === "max_quantity");
    expect(maxQtyRule?.message).toBe("Quantity 10 exceeds the maximum of 2 per item.");

    const shipRule = res.results.find((r) => r.rule === "ship_to_matches");
    expect(shipRule?.message).toBe("Ship-to address differs from the mandate address.");
  });

  it("handles rounding with float drift prices (0.1 + 0.2 and 49.99 * 3)", () => {
    const floatDriftProposal: ProposalInput = {
      items: [
        {
          productId: "item-1",
          title: "Item 1",
          merchant: "TrailGear",
          category: "Apparel",
          unitPrice: 0.1,
          quantity: 1,
          url: "https://example.com/1",
        },
        {
          productId: "item-2",
          title: "Item 2",
          merchant: "TrailGear",
          category: "Apparel",
          unitPrice: 0.2,
          quantity: 1,
          url: "https://example.com/2",
        },
        {
          productId: "item-3",
          title: "Item 3",
          merchant: "TrailGear",
          category: "Apparel",
          unitPrice: 19.99,
          quantity: 1,
          url: "https://example.com/3",
        },
      ],
      shipTo: validProposal.shipTo,
      currency: "USD",
      agentReasoning: "Precision test",
      sourceUrls: [],
    };

    const res = evaluate(floatDriftProposal, validMandate, defaultContext);
    expect(res.decision).toBe("allow");

    const multiplierProposal: ProposalInput = {
      items: [
        {
          productId: "item-4",
          title: "Tripled Item",
          merchant: "TrailGear",
          category: "Gear",
          unitPrice: 49.99,
          quantity: 3,
          url: "https://example.com/4",
        },
      ],
      shipTo: validProposal.shipTo,
      currency: "USD",
      agentReasoning: "Multiply test",
      sourceUrls: [],
    };

    const baseCustom = {
      ...baseMandateWithoutSignature,
      totalBudget: 200,
      perItemCap: 60,
      approvalThreshold: 100,
      maxQuantityPerItem: 5,
    };
    const multiplierMandate: Mandate = {
      ...baseCustom,
      signature: signMandate(baseCustom, testSigningSecret),
    };

    const resMultiplier = evaluate(
      multiplierProposal,
      multiplierMandate,
      defaultContext,
    );
    expect(resMultiplier.decision).toBe("ask");
    const budgetRule = resMultiplier.results.find((r) => r.rule === "within_budget");
    expect(budgetRule?.passed).toBe(true);
    const thresholdRule = resMultiplier.results.find(
      (r) => r.rule === "approval_threshold",
    );
    expect(thresholdRule?.passed).toBe(false);
  });

  it("gives ask when proposal is above threshold but otherwise valid", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          unitPrice: 55.0,
          quantity: 1,
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("ask");
    const failedRules = res.results.filter((r) => !r.passed);
    expect(failedRules).toHaveLength(1);
    expect(failedRules[0].rule).toBe("approval_threshold");
  });

  it("gives block when proposal is above threshold and also has a bad merchant", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          merchant: "Unlisted Merchant",
          unitPrice: 55.0,
          quantity: 1,
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    const failedRules = res.results.filter((r) => !r.passed).map((r) => r.rule);
    expect(failedRules).toContain("merchant_allowed");
    expect(failedRules).toContain("approval_threshold");
  });

  it("is a pure function that does not mutate inputs and returns deeply equal results", () => {
    const proposalCopy = JSON.parse(JSON.stringify(validProposal));
    const mandateCopy = JSON.parse(JSON.stringify(validMandate));
    const contextCopy = {
      spent: defaultContext.spent,
      now: new Date(defaultContext.now.getTime()),
      signingSecret: defaultContext.signingSecret,
    };

    const res1 = evaluate(validProposal, validMandate, defaultContext);
    const res2 = evaluate(validProposal, validMandate, defaultContext);

    expect(res1).toEqual(res2);
    expect(validProposal).toEqual(proposalCopy);
    expect(validMandate).toEqual(mandateCopy);
    expect(defaultContext.spent).toBe(contextCopy.spent);
    expect(defaultContext.now.getTime()).toBe(contextCopy.now.getTime());
    expect(defaultContext.signingSecret).toBe(contextCopy.signingSecret);
  });

  it("fails max_quantity with message Proposal has no items. and gives block when items list is empty", () => {
    const emptyProposal = { ...validProposal, items: [] };
    const res = evaluate(emptyProposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    expect(res.results).toHaveLength(10);
    const rule = res.results.find((r) => r.rule === "max_quantity");
    expect(rule?.passed).toBe(false);
    expect(rule?.message).toBe("Proposal has no items.");
  });

  it("fails per_item_cap and gives block when unit price is negative", () => {
    const proposal = {
      ...validProposal,
      items: [{ ...validProposal.items[0], unitPrice: -10 }],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    expect(res.results).toHaveLength(10);
    const capRule = res.results.find((r) => r.rule === "per_item_cap");
    expect(capRule?.passed).toBe(false);
    expect(capRule?.message).toBe("Item unit price -10 is invalid (must be a positive amount).");
  });

  it("fails per_item_cap and gives block when unit price is zero", () => {
    const proposal = {
      ...validProposal,
      items: [{ ...validProposal.items[0], unitPrice: 0 }],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    expect(res.results).toHaveLength(10);
    const capRule = res.results.find((r) => r.rule === "per_item_cap");
    expect(capRule?.passed).toBe(false);
    expect(capRule?.message).toBe("Item unit price 0 is invalid (must be a positive amount).");
  });

  it("fails per_item_cap and gives block without throwing when unit price is NaN", () => {
    const proposal = {
      ...validProposal,
      items: [{ ...validProposal.items[0], unitPrice: NaN }],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    expect(res.results).toHaveLength(10);
    const capRule = res.results.find((r) => r.rule === "per_item_cap");
    expect(capRule?.passed).toBe(false);
    expect(capRule?.message).toBe("Item unit price NaN is invalid (must be a positive amount).");
  });

  it("fails max_quantity and gives block when quantity is 1.5", () => {
    const proposal = {
      ...validProposal,
      items: [{ ...validProposal.items[0], quantity: 1.5 }],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    expect(res.results).toHaveLength(10);
    const qtyRule = res.results.find((r) => r.rule === "max_quantity");
    expect(qtyRule?.passed).toBe(false);
    expect(qtyRule?.message).toBe(
      "Quantity 1.5 is invalid (must be a whole number of at least 1 per item).",
    );
  });

  it("fails ship_to_matches and gives block without throwing when shipTo has a missing field", () => {
    const missingFieldShipTo = {
      name: "Jane Doe",
      line1: "123 Trail Way",
      city: "Portland",
    } as unknown as ProposalInput["shipTo"];
    const proposal = { ...validProposal, shipTo: missingFieldShipTo };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    expect(res.results).toHaveLength(10);
    const shipRule = res.results.find((r) => r.rule === "ship_to_matches");
    expect(shipRule?.passed).toBe(false);
    expect(shipRule?.message).toBe("Ship-to address differs from the mandate address.");
  });

  it("fails merchant_allowed and gives block without throwing when merchant is missing", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          merchant: undefined as unknown as string,
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    expect(res.results).toHaveLength(10);
    const merchRule = res.results.find((r) => r.rule === "merchant_allowed");
    expect(merchRule?.passed).toBe(false);
  });

  it("fails not_expired and gives block without throwing when expiresAt is invalid", () => {
    const invalidDateMandate = {
      ...validMandate,
      expiresAt: "invalid-date-string",
    };
    const res = evaluate(validProposal, invalidDateMandate, defaultContext);
    expect(res.decision).toBe("block");
    expect(res.results).toHaveLength(10);
    const expireRule = res.results.find((r) => r.rule === "not_expired");
    expect(expireRule?.passed).toBe(false);
  });

  it("prevents a negative price item from offsetting a valid item under budget or threshold", () => {
    const proposal: ProposalInput = {
      items: [
        {
          productId: "item-valid",
          title: "Expensive Item",
          merchant: "TrailGear",
          category: "Apparel",
          unitPrice: 100,
          quantity: 1,
          url: "https://example.com/item1",
        },
        {
          productId: "item-neg",
          title: "Negative Offset Item",
          merchant: "TrailGear",
          category: "Apparel",
          unitPrice: -60,
          quantity: 1,
          url: "https://example.com/item2",
        },
      ],
      shipTo: validProposal.shipTo,
      currency: "USD",
      agentReasoning: "Offset attempt",
      sourceUrls: [],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    expect(res.results).toHaveLength(10);
    const budgetRule = res.results.find((r) => r.rule === "within_budget");
    expect(budgetRule?.passed).toBe(false);
    expect(budgetRule?.message).toBe("Total could not be computed from the proposal.");
    const thresholdRule = res.results.find((r) => r.rule === "approval_threshold");
    expect(thresholdRule?.passed).toBe(false);
    expect(thresholdRule?.message).toBe("Total could not be computed from the proposal.");
  });
});
