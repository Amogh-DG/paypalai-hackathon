import type { Proposal } from "@leash/shared";
import type { PayPalAdapter } from "./adapter.js";
import { newId } from "../ids.js";

type MockOrder = {
  orderId: string;
  proposalId: string;
  amount: number;
  currency: string;
};

type MockAuthorization = {
  authorizationId: string;
  orderId: string;
  amount: number;
  currency: string;
  captured: boolean;
  voided: boolean;
};

export class MockPayPalAdapter implements PayPalAdapter {
  private orders = new Map<string, MockOrder>();
  private authorizations = new Map<string, MockAuthorization>();
  private publicBaseUrl: string;
  private authorizeAmountOverride?: number;

  constructor(options?: {
    publicBaseUrl?: string;
    authorizeAmountOverride?: number;
  }) {
    this.publicBaseUrl =
      options?.publicBaseUrl ||
      process.env.PUBLIC_BASE_URL ||
      "http://localhost:3000";
    this.authorizeAmountOverride = options?.authorizeAmountOverride;
  }

  setAuthorizeAmountOverride(amount?: number): void {
    this.authorizeAmountOverride = amount;
  }

  async createOrder(
    p: Proposal,
  ): Promise<{ orderId: string; approveUrl: string }> {
    const orderId = newId("ord_");
    const baseUrl = this.publicBaseUrl.replace(/\/+$/, "");
    const approveUrl = `${baseUrl}/api/mock/paypal/approve?proposalId=${encodeURIComponent(p.id)}&token=${encodeURIComponent(orderId)}`;

    this.orders.set(orderId, {
      orderId,
      proposalId: p.id,
      amount: p.total,
      currency: p.currency,
    });

    return { orderId, approveUrl };
  }

  async authorizeOrder(
    orderId: string,
  ): Promise<{ authorizationId: string; amount: number; currency: string }> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const authorizationId = newId("auth_");
    const amount =
      typeof this.authorizeAmountOverride === "number"
        ? this.authorizeAmountOverride
        : order.amount;

    this.authorizations.set(authorizationId, {
      authorizationId,
      orderId,
      amount,
      currency: order.currency,
      captured: false,
      voided: false,
    });

    return {
      authorizationId,
      amount,
      currency: order.currency,
    };
  }

  async captureAuthorization(
    authorizationId: string,
  ): Promise<{ captureId: string }> {
    const auth = this.authorizations.get(authorizationId);
    if (!auth) {
      throw new Error(`Authorization ${authorizationId} not found`);
    }
    if (auth.captured) {
      throw new Error(
        `Authorization ${authorizationId} has already been captured`,
      );
    }
    if (auth.voided) {
      throw new Error(`Authorization ${authorizationId} has been voided`);
    }

    auth.captured = true;
    const captureId = newId("cap_");
    return { captureId };
  }

  async voidAuthorization(authorizationId: string): Promise<void> {
    const auth = this.authorizations.get(authorizationId);
    if (!auth) {
      throw new Error(`Authorization ${authorizationId} not found`);
    }
    if (auth.voided) {
      throw new Error(
        `Authorization ${authorizationId} has already been voided`,
      );
    }
    if (auth.captured) {
      throw new Error(
        `Authorization ${authorizationId} has already been captured`,
      );
    }

    auth.voided = true;
  }
}
