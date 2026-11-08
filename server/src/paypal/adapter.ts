import type { Proposal } from "@leash/shared";

export interface PayPalAdapter {
  readonly mode: "mock" | "sandbox";
  createOrder(p: Proposal): Promise<{ orderId: string; approveUrl: string }>;
  authorizeOrder(
    orderId: string,
  ): Promise<{ authorizationId: string; amount: number; currency: string }>;
  captureAuthorization(authorizationId: string): Promise<{ captureId: string }>;
  voidAuthorization(authorizationId: string): Promise<void>;
}
