import { describe, it, expect } from "vitest";
import type { Mandate } from "@leash/shared";
import { signMandate, verifyMandate } from "../src/mandate/signing.js";

const baseMandate: Omit<Mandate, "signature"> = {
  id: "mandate_123",
  owner: "alice",
  currency: "USD",
  totalBudget: 80,
  perItemCap: 60,
  approvalThreshold: 50,
  allowedCategories: ["Apparel", "Footwear"],
  allowedMerchants: ["Acme Outdoors", "TrailGear"],
  maxQuantityPerItem: 2,
  shippingAddress: {
    name: "Alice Smith",
    line1: "123 Forest Lane",
    city: "Seattle",
    region: "WA",
    postalCode: "98101",
    country: "USA",
  },
  expiresAt: "2026-12-31T23:59:59Z",
  createdAt: "2026-11-01T00:00:00Z",
};

const secret = "test-secret-key-12345";

describe("mandate signing and verification", () => {
  it("gives the same signature for the same mandate", () => {
    const sig1 = signMandate(baseMandate, secret);
    const sig2 = signMandate(baseMandate, secret);
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64);
  });

  it("gives a different signature when total budget changes", () => {
    const originalSig = signMandate(baseMandate, secret);
    const modified = { ...baseMandate, totalBudget: 100 };
    const newSig = signMandate(modified, secret);
    expect(newSig).not.toBe(originalSig);
  });

  it("gives a different signature when an allowed merchant changes", () => {
    const originalSig = signMandate(baseMandate, secret);
    const modified = {
      ...baseMandate,
      allowedMerchants: ["Acme Outdoors", "DifferentMerchant"],
    };
    const newSig = signMandate(modified, secret);
    expect(newSig).not.toBe(originalSig);
  });

  it("gives a different signature when the shipping address changes", () => {
    const originalSig = signMandate(baseMandate, secret);
    const modified = {
      ...baseMandate,
      shippingAddress: {
        ...baseMandate.shippingAddress,
        city: "Portland",
      },
    };
    const newSig = signMandate(modified, secret);
    expect(newSig).not.toBe(originalSig);
  });

  it("gives a different signature when the expiry changes", () => {
    const originalSig = signMandate(baseMandate, secret);
    const modified = {
      ...baseMandate,
      expiresAt: "2027-01-01T00:00:00Z",
    };
    const newSig = signMandate(modified, secret);
    expect(newSig).not.toBe(originalSig);
  });

  it("verifies a valid signed mandate", () => {
    const signature = signMandate(baseMandate, secret);
    const mandate: Mandate = { ...baseMandate, signature };
    expect(verifyMandate(mandate, secret)).toBe(true);
  });

  it("fails verification when signed with a different secret", () => {
    const signature = signMandate(baseMandate, secret);
    const mandate: Mandate = { ...baseMandate, signature };
    expect(verifyMandate(mandate, "different-secret-key")).toBe(false);
  });

  it("returns false instead of throwing for a garbage signature of the wrong length", () => {
    const mandateShort: Mandate = { ...baseMandate, signature: "short" };
    expect(verifyMandate(mandateShort, secret)).toBe(false);

    const mandateEmpty: Mandate = { ...baseMandate, signature: "" };
    expect(verifyMandate(mandateEmpty, secret)).toBe(false);

    const mandateLong: Mandate = {
      ...baseMandate,
      signature: "a".repeat(65),
    };
    expect(verifyMandate(mandateLong, secret)).toBe(false);

    const mandateNonHex: Mandate = {
      ...baseMandate,
      signature: "z".repeat(64),
    };
    expect(verifyMandate(mandateNonHex, secret)).toBe(false);
  });
});
