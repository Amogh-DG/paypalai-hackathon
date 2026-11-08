import type { Database as DatabaseType } from "better-sqlite3";
import {
  type Proposal,
  centsToDollars,
  dollarsToCents,
} from "@leash/shared";
import type { PayPalAdapter } from "./adapter.js";
import { newId } from "../ids.js";
import { createDb } from "../db.js";

export type MockPayPalOptions = {
  db?: DatabaseType;
  publicBaseUrl?: string;
  authorizeAmountOverride?: number;
};

export class MockPayPalAdapter implements PayPalAdapter {
  readonly mode: "mock" = "mock";
  private db?: DatabaseType;
  private publicBaseUrl: string;
  private authorizeAmountOverride?: number;

  constructor(
    dbOrOptions?: DatabaseType | MockPayPalOptions,
    maybeOptions?: MockPayPalOptions,
  ) {
    if (
      dbOrOptions &&
      typeof (dbOrOptions as DatabaseType).prepare === "function"
    ) {
      this.db = dbOrOptions as DatabaseType;
      this.publicBaseUrl =
        maybeOptions?.publicBaseUrl ||
        process.env.PUBLIC_BASE_URL ||
        "http://localhost:3000";
      this.authorizeAmountOverride = maybeOptions?.authorizeAmountOverride;
    } else {
      const opts = (dbOrOptions as MockPayPalOptions) || {};
      this.db = opts.db;
      this.publicBaseUrl =
        opts.publicBaseUrl ||
        process.env.PUBLIC_BASE_URL ||
        "http://localhost:3000";
      this.authorizeAmountOverride = opts.authorizeAmountOverride;
    }
  }

  setDb(db: DatabaseType): void {
    this.db = db;
  }

  hasDb(): boolean {
    return Boolean(this.db);
  }

  private getDb(): DatabaseType {
    if (!this.db) {
      this.db = createDb(":memory:");
    }
    return this.db;
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
    const amountCents = dollarsToCents(p.total);

    this.getDb()
      .prepare(`
        INSERT INTO mock_orders (id, proposal_id, amount_cents, currency, status)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(orderId, p.id, amountCents, p.currency, "created");

    return { orderId, approveUrl };
  }

  async authorizeOrder(
    orderId: string,
  ): Promise<{ authorizationId: string; amount: number; currency: string }> {
    const db = this.getDb();
    const order = db
      .prepare(`
        SELECT id, proposal_id, amount_cents, currency, status
        FROM mock_orders
        WHERE id = ?
      `)
      .get(orderId) as
      | {
          id: string;
          proposal_id: string;
          amount_cents: number;
          currency: string;
          status: string;
        }
      | undefined;

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const existingAuth = db
      .prepare(`SELECT id FROM mock_authorizations WHERE order_id = ?`)
      .get(orderId);

    if (existingAuth || order.status === "authorized") {
      throw new Error(`Order ${orderId} has already been authorized`);
    }

    const authorizationId = newId("auth_");
    const amount =
      typeof this.authorizeAmountOverride === "number"
        ? this.authorizeAmountOverride
        : centsToDollars(order.amount_cents);

    const authCents = dollarsToCents(amount);

    db.prepare(`
      INSERT INTO mock_authorizations (id, order_id, amount_cents, currency, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(authorizationId, orderId, authCents, order.currency, "authorized");

    db.prepare(`
      UPDATE mock_orders SET status = 'authorized' WHERE id = ?
    `).run(orderId);

    return {
      authorizationId,
      amount,
      currency: order.currency,
    };
  }

  async captureAuthorization(
    authorizationId: string,
  ): Promise<{ captureId: string }> {
    const db = this.getDb();
    const auth = db
      .prepare(`
        SELECT id, order_id, amount_cents, currency, status
        FROM mock_authorizations
        WHERE id = ?
      `)
      .get(authorizationId) as
      | {
          id: string;
          order_id: string;
          amount_cents: number;
          currency: string;
          status: string;
        }
      | undefined;

    if (!auth) {
      throw new Error(`Authorization ${authorizationId} not found`);
    }
    if (auth.status === "captured") {
      throw new Error(
        `Authorization ${authorizationId} has already been captured`,
      );
    }
    if (auth.status === "voided") {
      throw new Error(`Authorization ${authorizationId} has been voided`);
    }

    db.prepare(`
      UPDATE mock_authorizations SET status = 'captured' WHERE id = ?
    `).run(authorizationId);

    const captureId = newId("cap_");
    return { captureId };
  }

  async voidAuthorization(authorizationId: string): Promise<void> {
    const db = this.getDb();
    const auth = db
      .prepare(`
        SELECT id, order_id, amount_cents, currency, status
        FROM mock_authorizations
        WHERE id = ?
      `)
      .get(authorizationId) as
      | {
          id: string;
          order_id: string;
          amount_cents: number;
          currency: string;
          status: string;
        }
      | undefined;

    if (!auth) {
      throw new Error(`Authorization ${authorizationId} not found`);
    }
    if (auth.status === "voided") {
      throw new Error(
        `Authorization ${authorizationId} has already been voided`,
      );
    }
    if (auth.status === "captured") {
      throw new Error(
        `Authorization ${authorizationId} has already been captured`,
      );
    }

    db.prepare(`
      UPDATE mock_authorizations SET status = 'voided' WHERE id = ?
    `).run(authorizationId);
  }
}
