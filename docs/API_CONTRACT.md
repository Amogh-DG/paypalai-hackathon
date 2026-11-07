# Leash API Contract

Both people code against this file. If something must change, change this file first and tell the other person.

Base path: /api. JSON, UTF-8. Money is a number in major units with 2 decimals (49.99). Currency is always "USD". Timestamps are ISO 8601 UTC. Errors: HTTP status plus body {"error":{"code":"string","message":"string"}}.

## Shared types (create as shared/types.ts exactly as written)

```ts
export type Address = {
  name: string;
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

export type MandateInput = {
  owner: string;
  currency: "USD";
  totalBudget: number;
  perItemCap: number;
  approvalThreshold: number;
  allowedCategories: string[];
  allowedMerchants: string[];
  maxQuantityPerItem: number;
  shippingAddress: Address;
  expiresAt: string;
};

export type Mandate = MandateInput & {
  id: string;
  createdAt: string;
  signature: string;
};

export type MandateView = Omit<Mandate, "signature"> & {
  spent: number;
  remaining: number;
};

export type Product = {
  productId: string;
  title: string;
  merchant: string;
  category: string;
  price: number;
  url: string;
  imageUrl?: string;
};

export type ProposalItem = {
  productId: string;
  title: string;
  merchant: string;
  category: string;
  unitPrice: number;
  quantity: number;
  url: string;
};

export type ProposalInput = {
  items: ProposalItem[];
  shipTo: Address;
  currency: "USD";
  agentReasoning: string;
  sourceUrls: string[];
};

export type RuleResult = {
  rule: string;
  passed: boolean;
  severity: "block" | "ask";
  message: string;
};

export type PolicyDecision = {
  decision: "allow" | "ask" | "block";
  results: RuleResult[];
  evaluatedAt: string;
};

export type ProposalStatus =
  | "blocked"
  | "needs_approval"
  | "rejected"
  | "approved"
  | "awaiting_buyer"
  | "authorized"
  | "captured"
  | "voided"
  | "failed";

export type PaymentInfo = {
  mode: "mock" | "sandbox";
  orderId?: string;
  authorizationId?: string;
  captureId?: string;
  approveUrl?: string;
};

export type Proposal = ProposalInput & {
  id: string;
  createdAt: string;
  total: number;
  status: ProposalStatus;
  policy: PolicyDecision;
  payment?: PaymentInfo;
};

export type AuditEvent =
  | "proposal_received"
  | "policy_decision"
  | "user_decision"
  | "order_created"
  | "buyer_approved"
  | "authorized"
  | "recheck"
  | "captured"
  | "voided"
  | "webhook"
  | "error";

export type AuditEntry = {
  id: string;
  timestamp: string;
  proposalId?: string;
  event: AuditEvent;
  summary: string;
  amount?: number;
  decision?: "allow" | "ask" | "block";
  details: Record<string, unknown>;
};
```

## Endpoints

### POST /api/mandate (owner: A)
Body: MandateInput. Creates the mandate, signs it, replaces any previous one. Returns 201 Mandate.

### GET /api/mandate (owner: A)
Returns MandateView. 404 with code "no_mandate" if none exists.

### POST /api/chat (owner: B)
Body: {"sessionId"?: string, "message": string}
Returns: {"sessionId": string, "reply": string, "proposalIds": string[], "toolTrace": {"tool": string, "summary": string}[]}
Runs the agent. Any purchase the agent proposes appears in proposalIds.

### GET /api/proposals (owner: A)
Returns Proposal[] newest first.

### GET /api/proposals/:id (owner: A)
Returns Proposal. 404 if unknown.

### POST /api/proposals/:id/decision (owner: A)
Body: {"action": "approve" | "reject"}
Only valid when status is needs_approval. approve continues to payment. reject sets status rejected. Returns Proposal.

### GET /api/paypal/return?proposalId=...&token=ORDER_ID (owner: A)
Buyer comes back from PayPal after approving. Server authorizes the order, re-checks, then captures or voids, then redirects (302) to /?proposal={id}.

### GET /api/paypal/cancel?proposalId=... (owner: A)
Buyer cancelled. Status becomes voided. Redirects to /?proposal={id}.

### GET /api/mock/paypal/approve?proposalId=...&token=ORDER_ID (owner: A)
Mock mode only. Simulates the buyer approving, redirects to the return endpoint.

### POST /api/paypal/webhook (owner: A)
PayPal webhook receiver. Verifies signature in sandbox mode, writes an audit entry, updates payment info.

### GET /api/audit?limit=200 (owner: A)
Returns AuditEntry[] newest first.

### GET /shady/:file (owner: B)
Static HTML pages for the injection demo. Example: /shady/hiking-deals.html

## Proposal status flow

Policy decision block: status blocked. Nothing is sent to PayPal.
Policy decision ask: status needs_approval, then approved or rejected by the user.
Policy decision allow, or approved by user: approved, then order created, status awaiting_buyer, then authorized, then captured. If the re-check after authorization fails or amounts differ: voided. Any technical error: failed.

## Internal module contracts (function calls, not HTTP)

server/src/proposals/service.ts (owner: A) exports:

```ts
export function submitProposal(input: ProposalInput): Promise<Proposal>;
export function getMandateView(): MandateView | null;
```

submitProposal validates input with zod, stores it, runs the policy engine, writes audit entries, starts the payment flow when the decision is allow, and returns the stored Proposal with its status.

server/src/agent/index.ts (owner: B) exports:

```ts
export function runAgent(
  sessionId: string,
  message: string
): Promise<{
  reply: string;
  proposalIds: string[];
  toolTrace: { tool: string; summary: string }[];
}>;
```

server/src/agent/products.ts (owner: B) exports:

```ts
export function searchProducts(query: string, maxPrice?: number): Promise<Product[]>;
export function fetchPageText(url: string): Promise<string>;
```

## Boundary rules

- Agent code may import only submitProposal and getMandateView from A's code.
- Policy and payment code must never import anything from the agent folder.
- The agent never receives the mandate signature or any PayPal credential.

## Environment variables (.env.example)

PORT, PAYPAL_MODE (mock or sandbox), PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, MANDATE_SIGNING_SECRET, PUBLIC_BASE_URL, LLM_PROVIDER, LLM_API_KEY, CHANNEL3_API_KEY, AGENT_NAIVE (true or false), DATABASE_PATH
