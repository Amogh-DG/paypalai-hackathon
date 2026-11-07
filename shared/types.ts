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

export type UserDecision = {
  action: "approve" | "reject";
  decidedAt: string;
};

export type Proposal = ProposalInput & {
  id: string;
  createdAt: string;
  total: number;
  status: ProposalStatus;
  policy: PolicyDecision;
  payment?: PaymentInfo;
  userDecision?: UserDecision;
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

export const ERROR_CODES = {
  VALIDATION_ERROR: "validation_error",
  NO_MANDATE: "no_mandate",
  NOT_FOUND: "not_found",
  INVALID_STATE: "invalid_state",
  MANDATE_EXPIRED: "mandate_expired",
  PAYPAL_ERROR: "paypal_error",
  MODEL_BUSY: "model_busy",
  INTERNAL_ERROR: "internal_error",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  [ERROR_CODES.VALIDATION_ERROR]: 400,
  [ERROR_CODES.NO_MANDATE]: 404,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.INVALID_STATE]: 409,
  [ERROR_CODES.MANDATE_EXPIRED]: 409,
  [ERROR_CODES.PAYPAL_ERROR]: 502,
  [ERROR_CODES.MODEL_BUSY]: 502,
  [ERROR_CODES.INTERNAL_ERROR]: 500,
};

export const FINAL_STATUSES: readonly ProposalStatus[] = [
  "blocked",
  "rejected",
  "captured",
  "voided",
  "failed",
];

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export function hasAtMostTwoDecimals(value: number): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }
  const rounded = Math.round(value * 100) / 100;
  return Math.abs(value - rounded) < 1e-9;
}
