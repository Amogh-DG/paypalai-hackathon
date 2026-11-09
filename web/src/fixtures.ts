import type { AuditEntry, MandateView, Proposal } from "@leash/shared";

export const mandateFixture: MandateView = {
  id: "mandate_demo",
  owner: "Alice",
  currency: "USD",
  totalBudget: 80,
  perItemCap: 60,
  approvalThreshold: 50,
  allowedCategories: ["hiking", "books"],
  allowedMerchants: ["Trail Supply"],
  maxQuantityPerItem: 2,
  shippingAddress: {
    name: "Alice",
    line1: "123 Demo Lane",
    city: "Portland",
    region: "OR",
    postalCode: "97201",
    country: "US",
  },
  expiresAt: "2026-12-01T00:00:00.000Z",
  createdAt: "2026-11-08T09:00:00.000Z",
  spent: 47.5,
  remaining: 32.5,
};

export const capturedProposalFixture: Proposal = {
  id: "prop_captured_demo",
  createdAt: "2026-11-08T09:05:00.000Z",
  items: [
    {
      productId: "bottle_demo",
      title: "Trail water bottle",
      merchant: "Trail Supply",
      category: "hiking",
      unitPrice: 47.5,
      quantity: 1,
      url: "https://example.com/trail-bottle",
    },
  ],
  shipTo: { ...mandateFixture.shippingAddress },
  currency: "USD",
  agentReasoning: "A hiking gift within the mandate limits.",
  sourceUrls: ["https://example.com/trail-bottle"],
  total: 47.5,
  status: "captured",
  policy: {
    decision: "allow",
    results: [],
    evaluatedAt: "2026-11-08T09:05:01.000Z",
  },
  payment: {
    mode: "mock",
    orderId: "order_demo",
    authorizationId: "auth_demo",
    captureId: "capture_demo",
  },
};

export const approvalProposalFixture: Proposal = {
  id: "prop_approval_demo",
  createdAt: "2026-11-08T09:02:00.000Z",
  items: [
    {
      productId: "pack_demo",
      title: "Day hiking pack",
      merchant: "Trail Supply",
      category: "hiking",
      unitPrice: 55,
      quantity: 1,
      url: "https://example.com/day-pack",
    },
  ],
  shipTo: { ...mandateFixture.shippingAddress },
  currency: "USD",
  agentReasoning: "A hiking pack that requires owner approval.",
  sourceUrls: ["https://example.com/day-pack"],
  total: 55,
  status: "needs_approval",
  policy: {
    decision: "ask",
    results: [
      {
        rule: "approval_threshold",
        passed: false,
        severity: "ask",
        message: "The total exceeds the $50 approval threshold.",
      },
    ],
    evaluatedAt: "2026-11-08T09:02:01.000Z",
  },
};

export const auditEntryFixture: AuditEntry = {
  id: "audit_capture_demo",
  timestamp: "2026-11-08T09:06:00.000Z",
  proposalId: capturedProposalFixture.id,
  event: "captured",
  summary: "Mock payment captured for the trail water bottle.",
  amount: 47.5,
  decision: "allow",
  details: { mode: "mock", captureId: "capture_demo" },
};
