import type { MandateView, Proposal, ProposalInput } from "@leash/shared";

export const fixedAllowProposal: Proposal = {
  id: "proposal_allow",
  createdAt: "2026-11-07T12:00:00.000Z",
  items: [
    {
      productId: "item-1",
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
  agentReasoning: "Found hiking socks within budget and allowed merchants",
  sourceUrls: ["https://example.com/socks"],
  total: 20,
  status: "approved",
  policy: {
    decision: "allow",
    results: [
      { rule: "signature_valid", passed: true, severity: "block", message: "Signature valid" },
      { rule: "not_expired", passed: true, severity: "block", message: "Mandate active" },
      { rule: "currency_match", passed: true, severity: "block", message: "Currency matches" },
      { rule: "merchant_allowed", passed: true, severity: "block", message: "Merchant allowed" },
      { rule: "category_allowed", passed: true, severity: "block", message: "Category allowed" },
      { rule: "per_item_cap", passed: true, severity: "block", message: "Within per-item cap" },
      { rule: "max_quantity", passed: true, severity: "block", message: "Within max quantity" },
      { rule: "ship_to_matches", passed: true, severity: "block", message: "Ship-to matches" },
      { rule: "within_budget", passed: true, severity: "block", message: "Within budget" },
      { rule: "approval_threshold", passed: true, severity: "ask", message: "Below approval threshold" },
    ],
    evaluatedAt: "2026-11-07T12:00:00.000Z",
  },
  payment: {
    mode: "mock",
    orderId: "order_allow",
  },
};

export const fixedAskProposal: Proposal = {
  id: "proposal_ask",
  createdAt: "2026-11-07T12:00:00.000Z",
  items: [
    {
      productId: "item-2",
      title: "Hiking Boots",
      merchant: "TrailGear",
      category: "Footwear",
      unitPrice: 65,
      quantity: 1,
      url: "https://example.com/boots",
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
  agentReasoning: "Boots exceed the 50 USD threshold requiring user approval",
  sourceUrls: ["https://example.com/boots"],
  total: 65,
  status: "needs_approval",
  policy: {
    decision: "ask",
    results: [
      { rule: "signature_valid", passed: true, severity: "block", message: "Signature valid" },
      { rule: "not_expired", passed: true, severity: "block", message: "Mandate active" },
      { rule: "currency_match", passed: true, severity: "block", message: "Currency matches" },
      { rule: "merchant_allowed", passed: true, severity: "block", message: "Merchant allowed" },
      { rule: "category_allowed", passed: true, severity: "block", message: "Category allowed" },
      { rule: "per_item_cap", passed: true, severity: "block", message: "Within per-item cap" },
      { rule: "max_quantity", passed: true, severity: "block", message: "Within max quantity" },
      { rule: "ship_to_matches", passed: true, severity: "block", message: "Ship-to matches" },
      { rule: "within_budget", passed: true, severity: "block", message: "Within budget" },
      { rule: "approval_threshold", passed: false, severity: "ask", message: "Total exceeds approval threshold of 50.00 USD" },
    ],
    evaluatedAt: "2026-11-07T12:00:00.000Z",
  },
};

export const fixedBlockProposal: Proposal = {
  id: "proposal_block",
  createdAt: "2026-11-07T12:00:00.000Z",
  items: [
    {
      productId: "item-3",
      title: "Malicious Deal Backpack",
      merchant: "ShadyMerchant",
      category: "Gear",
      unitPrice: 30,
      quantity: 10,
      url: "https://shady.example.com/deal",
    },
  ],
  shipTo: {
    name: "Attacker",
    line1: "999 Rogue Rd",
    city: "Elsewhere",
    region: "CA",
    postalCode: "90001",
    country: "US",
  },
  currency: "USD",
  agentReasoning: "Proposed purchase from shady page with high quantity and modified shipping address",
  sourceUrls: ["https://shady.example.com/deal"],
  total: 300,
  status: "blocked",
  policy: {
    decision: "block",
    results: [
      { rule: "signature_valid", passed: true, severity: "block", message: "Signature valid" },
      { rule: "not_expired", passed: true, severity: "block", message: "Mandate active" },
      { rule: "currency_match", passed: true, severity: "block", message: "Currency matches" },
      { rule: "merchant_allowed", passed: false, severity: "block", message: "Merchant ShadyMerchant is not in allowed merchants" },
      { rule: "category_allowed", passed: true, severity: "block", message: "Category allowed" },
      { rule: "per_item_cap", passed: true, severity: "block", message: "Within per-item cap" },
      { rule: "max_quantity", passed: false, severity: "block", message: "Quantity 10 exceeds maximum allowed quantity of 2" },
      { rule: "ship_to_matches", passed: false, severity: "block", message: "Shipping address does not match mandate shipping address" },
      { rule: "within_budget", passed: true, severity: "block", message: "Within budget" },
      { rule: "approval_threshold", passed: false, severity: "ask", message: "Total exceeds approval threshold" },
    ],
    evaluatedAt: "2026-11-07T12:00:00.000Z",
  },
};

export async function submitProposal(input: ProposalInput): Promise<Proposal> {
  if (
    input.agentReasoning?.includes("block") ||
    input.items.some((item) => item.quantity > 2 || item.merchant.toLowerCase().includes("shady")) ||
    input.shipTo.name === "Attacker"
  ) {
    return fixedBlockProposal;
  }
  if (
    input.agentReasoning?.includes("ask") ||
    input.items.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0) > 50
  ) {
    return fixedAskProposal;
  }
  return fixedAllowProposal;
}

export function getMandateView(): MandateView | null {
  return {
    id: "mandate_stub_1",
    owner: "demo-user",
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
    createdAt: "2026-11-07T12:00:00.000Z",
    spent: 0,
    remaining: 80,
  };
}
