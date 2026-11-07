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

describe("policy engine part 1 tests", () => {
  it("fails signature_valid when mandate is changed after signing (total budget)", () => {
    const tampered = { ...validMandate, totalBudget: 150 };
    const res = evaluate(validProposal, tampered, defaultContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "signature_valid");
    expect(rule?.passed).toBe(false);
  });

  it("fails signature_valid when mandate is signed with a different secret", () => {
    const mandateWithOtherSecret: Mandate = {
      ...baseMandateWithoutSignature,
      signature: signMandate(baseMandateWithoutSignature, "different-secret-xyz"),
    };
    const res = evaluate(validProposal, mandateWithOtherSecret, defaultContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "signature_valid");
    expect(rule?.passed).toBe(false);
  });

  it("fails not_expired when expiring exactly at now, and passes one second later", () => {
    const exactNow = new Date("2026-11-05T12:00:00.000Z");
    const baseExpiringExact = {
      ...baseMandateWithoutSignature,
      expiresAt: exactNow.toISOString(),
    };
    const mandateExpiringExact: Mandate = {
      ...baseExpiringExact,
      signature: signMandate(baseExpiringExact, testSigningSecret),
    };

    const resExact = evaluate(validProposal, mandateExpiringExact, {
      ...defaultContext,
      now: exactNow,
    });
    expect(resExact.decision).toBe("block");
    const ruleExact = resExact.results.find((r) => r.rule === "not_expired");
    expect(ruleExact?.passed).toBe(false);

    const baseExpiringLater = {
      ...baseMandateWithoutSignature,
      expiresAt: new Date(exactNow.getTime() + 1000).toISOString(),
    };
    const mandateExpiringLater: Mandate = {
      ...baseExpiringLater,
      signature: signMandate(baseExpiringLater, testSigningSecret),
    };

    const resLater = evaluate(validProposal, mandateExpiringLater, {
      ...defaultContext,
      now: exactNow,
    });
    const ruleLater = resLater.results.find((r) => r.rule === "not_expired");
    expect(ruleLater?.passed).toBe(true);
  });

  it("fails merchant_allowed with the unlisted merchant named in the message", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          merchant: "UnlistedStoreX",
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "merchant_allowed");
    expect(rule?.passed).toBe(false);
    expect(rule?.message).toBe('Merchant "UnlistedStoreX" is not in the allowed merchants list');
  });

  it("passes merchant_allowed when merchant names differ only in case or extra spaces", () => {
    const proposal = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          merchant: "  trailgear  ",
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    const rule = res.results.find((r) => r.rule === "merchant_allowed");
    expect(rule?.passed).toBe(true);
  });

  it("fails merchant_allowed when proposal has one good and one bad merchant", () => {
    const proposal: ProposalInput = {
      ...validProposal,
      items: [
        {
          ...validProposal.items[0],
          merchant: "TrailGear",
        },
        {
          productId: "prod-2",
          title: "Bad Merchant Item",
          merchant: "ForbiddenMerchant",
          category: "Apparel",
          unitPrice: 15,
          quantity: 1,
          url: "https://example.com/item2",
        },
      ],
    };
    const res = evaluate(proposal, validMandate, defaultContext);
    expect(res.decision).toBe("block");
    const rule = res.results.find((r) => r.rule === "merchant_allowed");
    expect(rule?.passed).toBe(false);
    expect(rule?.message).toContain("ForbiddenMerchant");
  });

  it("gives block when any single block-severity rule fails", () => {
    const badSigMandate = { ...validMandate, signature: "0".repeat(64) };
    expect(evaluate(validProposal, badSigMandate, defaultContext).decision).toBe("block");

    const expiredContext = { ...defaultContext, now: new Date("2028-01-01T00:00:00Z") };
    expect(evaluate(validProposal, validMandate, expiredContext).decision).toBe("block");

    const badCurrencyProposal = { ...validProposal, currency: "EUR" as unknown as "USD" };
    expect(evaluate(badCurrencyProposal, validMandate, defaultContext).decision).toBe("block");

    const badMerchantProposal = {
      ...validProposal,
      items: [{ ...validProposal.items[0], merchant: "BadMerchant" }],
    };
    expect(evaluate(badMerchantProposal, validMandate, defaultContext).decision).toBe("block");

    const badCatProposal = {
      ...validProposal,
      items: [{ ...validProposal.items[0], category: "BadCategory" }],
    };
    expect(evaluate(badCatProposal, validMandate, defaultContext).decision).toBe("block");

    const overCapProposal = {
      ...validProposal,
      items: [{ ...validProposal.items[0], unitPrice: 70 }],
    };
    expect(evaluate(overCapProposal, validMandate, defaultContext).decision).toBe("block");

    const overQtyProposal = {
      ...validProposal,
      items: [{ ...validProposal.items[0], quantity: 3 }],
    };
    expect(evaluate(overQtyProposal, validMandate, defaultContext).decision).toBe("block");

    const badShipProposal = {
      ...validProposal,
      shipTo: { ...validProposal.shipTo, city: "WrongCity" },
    };
    expect(evaluate(badShipProposal, validMandate, defaultContext).decision).toBe("block");

    const overBudgetProposal = {
      ...validProposal,
      items: [{ ...validProposal.items[0], unitPrice: 50, quantity: 2 }],
    };
    expect(evaluate(overBudgetProposal, validMandate, defaultContext).decision).toBe("block");
  });
});
