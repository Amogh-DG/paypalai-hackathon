# Role A: the money path

You own everything between "the agent proposed a purchase" and "PayPal moved or did not move money", plus the audit log. Read PRD.md and API_CONTRACT.md first. Follow them exactly.

No code comments anywhere. TypeScript strict mode. Validate all external input with zod.

## You own

- Repository scaffold, shared/types.ts, .env.example, README, LICENSE (MIT)
- server/src/mandate/ : creation, HMAC signing, verification, storage
- server/src/policy/ : policy engine
- server/src/paypal/ : PayPal adapter with mock and sandbox implementations
- server/src/proposals/ : service and state machine
- server/src/audit/ : audit storage
- Endpoints: /api/mandate, /api/proposals, /api/proposals/:id/decision, /api/paypal/*, /api/mock/paypal/approve, /api/audit
- web/src/pages/AuditPage.tsx : AG Grid audit log
- SQLite schema via better-sqlite3

## Build order

### Step 1: scaffold (Nov 3-4)
Create the repository layout from PRD.md. Express app with a health endpoint, zod, vitest, better-sqlite3, shared/types.ts copied from API_CONTRACT.md. Web app is created by Role B; you only add AuditPage into it later. Share the scaffold with Role B as soon as it runs.

### Step 2: policy engine (Nov 4-5)
Pure function in server/src/policy/evaluate.ts:

```ts
evaluate(
  proposal: ProposalInput,
  mandate: Mandate,
  context: { spent: number; now: Date; signingSecret: string }
): PolicyDecision
```

Rules, each producing one RuleResult:
- signature_valid (block): recompute HMAC SHA-256 over the mandate fields and compare with timing-safe equality.
- not_expired (block): now is before expiresAt.
- currency_match (block): proposal currency equals mandate currency.
- merchant_allowed (block): every item merchant is in allowedMerchants, case-insensitive.
- category_allowed (block): every item category is in allowedCategories.
- per_item_cap (block): every unitPrice is at most perItemCap.
- max_quantity (block): every quantity is at most maxQuantityPerItem and at least 1.
- ship_to_matches (block): shipTo equals mandate shippingAddress after trimming, lowercasing and collapsing whitespace, all fields.
- within_budget (block): context.spent plus proposal total is at most totalBudget.
- approval_threshold (ask): proposal total is above approvalThreshold.

Total is the sum of unitPrice times quantity, rounded to 2 decimals using integer cents internally. Decision is block if any block rule failed, else ask if the ask rule failed, else allow. Each message must be human readable, for example "Ship-to address differs from the mandate address" or "Quantity 10 exceeds the maximum of 2 per item".

Write vitest tests: at least 20 cases, one per rule passing and failing, a combined attack case (unlisted merchant, quantity 10, different address) expecting block with all three reasons, a rounding case, and a tampered-signature case.

### Step 3: proposal service and audit (Nov 5-6)
Implement submitProposal and getMandateView per the contract. Statuses and transitions are in API_CONTRACT.md. Spent for the budget rule is the sum of totals of proposals in awaiting_buyer, authorized or captured. Write an audit entry for proposal_received and policy_decision on every proposal, including blocked ones. Implement GET endpoints and POST decision. Give Role B a working submitProposal as early as possible, even if payment is still a stub, so she can integrate the agent.

### Step 4: PayPal adapter, mock first (Nov 6-7)
Interface in server/src/paypal/adapter.ts:

```ts
interface PayPalAdapter {
  createOrder(p: Proposal): Promise<{ orderId: string; approveUrl: string }>;
  authorizeOrder(orderId: string): Promise<{ authorizationId: string; amount: number; currency: string }>;
  captureAuthorization(authorizationId: string): Promise<{ captureId: string }>;
  voidAuthorization(authorizationId: string): Promise<void>;
}
```

Mock implementation: in-memory orders, approveUrl points to /api/mock/paypal/approve, which redirects to the return endpoint. Selected by PAYPAL_MODE. Everything must work end to end in mock mode.

Sandbox implementation (when the sandbox account works; verify every request shape against developer.paypal.com Orders v2 and Payments v2 docs, do not guess):
- Base URL https://api-m.sandbox.paypal.com
- OAuth: POST /v1/oauth2/token with client credentials, cache the token until expiry.
- Create order: POST /v2/checkout/orders with intent AUTHORIZE, purchase units with item breakdown and shipping, application_context or payment_source return_url and cancel_url pointing to /api/paypal/return and /api/paypal/cancel with proposalId.
- Authorize: POST /v2/checkout/orders/{id}/authorize
- Capture: POST /v2/payments/authorizations/{id}/capture
- Void: POST /v2/payments/authorizations/{id}/void
- Send a unique PayPal-Request-Id header on every POST for idempotency.
- Webhook verification: POST /v1/notifications/verify-webhook-signature. Events: PAYMENT.AUTHORIZATION.CREATED, PAYMENT.CAPTURE.COMPLETED, PAYMENT.AUTHORIZATION.VOIDED.

### Step 5: payment flow and re-check (Nov 7-8)
On allow or user approval: create order, store orderId and approveUrl, status awaiting_buyer, audit order_created. The web app sends the buyer to approveUrl.
On return: authorize, audit authorized. Then re-check: authorized amount and currency equal the proposal total, and the policy engine still returns allow or an approved ask against the current mandate. If it passes, capture, status captured, audit captured. If it fails, void, status voided, audit voided with the reason. On any exception status failed, audit error. Make the return handler idempotent, so reloading it does nothing twice.

### Step 6: webhooks and audit page (Nov 8-9)
Webhook endpoint with raw body handling and signature verification in sandbox mode. In mock mode, emit equivalent internal webhook entries after capture and void so the audit log looks the same. Build AuditPage.tsx with ag-grid-react: columns time, event, proposal, decision, amount, summary, with a row detail view showing the per-rule results. Color the decision cell green, amber or red. Quick filter box, sorting, and auto refresh every 3 seconds.

### Step 7: hardening (Nov 9-10)
Test these paths: double submit, return handler called twice, void after authorize, mandate replaced mid-flow, expired mandate, empty items, negative price, huge quantity. Write the README with setup, mock mode run, sandbox run, architecture description, and the tools list for the submission.

## Handoffs

- To B by Nov 5: running scaffold, shared/types.ts, working submitProposal (stubbed payment is fine).
- To B by Nov 8: full payment flow in mock mode so approval UI can be built against real statuses.
- From B: agent calling submitProposal, web app shell with navigation, shady page.

## Acceptance criteria

- vitest suite passes with at least 20 policy tests.
- A normal allowed purchase reaches captured in mock mode with a full audit trail.
- The combined attack proposal reaches blocked with at least three reasons and creates no PayPal order.
- An amount above the approval threshold waits for approval and then completes.
- Audit page shows every event live.
- Sandbox mode completes the same flow once the account works.

## Do not

- Do not give the agent any PayPal function.
- Do not let any endpoint modify a mandate without recomputing the signature.
- Do not store real secrets in the repository.
