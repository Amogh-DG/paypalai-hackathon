import type { Mandate, ProposalInput } from "@leash/shared";
import { signMandate } from "../src/mandate/signing.js";

export const testSigningSecret = "policy-engine-test-secret-2026";

export const baseMandateWithoutSignature: Omit<Mandate, "signature"> = {
  id: "mandate_test_1",
  owner: "test-user",
  currency: "USD",
  totalBudget: 80,
  perItemCap: 60,
  approvalThreshold: 50,
  allowedCategories: ["Apparel", "Footwear", "Gear"],
  allowedMerchants: ["TrailGear", "Acme Outdoors"],
  maxQuantityPerItem: 2,
  shippingAddress: {
    name: "Jane Doe",
    line1: "123 Trail Way",
    city: "Portland",
    region: "OR",
    postalCode: "97201",
    country: "US",
  },
  expiresAt: "2026-12-31T23:59:59.000Z",
  createdAt: "2026-11-01T00:00:00.000Z",
};

export const validMandate: Mandate = {
  ...baseMandateWithoutSignature,
  signature: signMandate(baseMandateWithoutSignature, testSigningSecret),
};

export const validProposal: ProposalInput = {
  items: [
    {
      productId: "prod-1",
      title: "Hiking Socks",
      merchant: "TrailGear",
      category: "Apparel",
      unitPrice: 20,
      quantity: 1,
      url: "https://example.com/socks",
    },
  ],
  shipTo: {
    name: "Jane Doe",
    line1: "123 Trail Way",
    city: "Portland",
    region: "OR",
    postalCode: "97201",
    country: "US",
  },
  currency: "USD",
  agentReasoning: "Legitimate purchase under threshold",
  sourceUrls: ["https://example.com/socks"],
};

export const defaultContext = {
  spent: 0,
  now: new Date("2026-11-05T12:00:00.000Z"),
  signingSecret: testSigningSecret,
};
