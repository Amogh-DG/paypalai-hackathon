import type { Proposal } from "@leash/shared";

export interface PayPalAdapter {
  createOrder(p: Proposal): Promise<{ orderId: string; approveUrl: string }>;
  authorizeOrder(
    orderId: string,
  ): Promise<{ authorizationId: string; amount: number; currency: string }>;
  captureAuthorization(authorizationId: string): Promise<{ captureId: string }>;
  voidAuthorization(authorizationId: string): Promise<void>;
}
