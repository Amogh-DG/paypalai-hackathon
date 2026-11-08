import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Database as DatabaseType } from "better-sqlite3";
import type { Proposal } from "@leash/shared";
import { createDb } from "../src/db.js";
import { MockPayPalAdapter } from "../src/paypal/mock.js";

describe("mock paypal adapter sqlite storage", () => {
  let tempDir: string;
  let dbPath: string;
  let activeDbs: DatabaseType[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-mock-paypal-"));
    dbPath = path.join(tempDir, "mock-paypal.db");
    activeDbs = [];
  });

  afterEach(() => {
    for (const db of activeDbs) {
      if (db.open) {
        db.close();
      }
    }
    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  });

  function openDb(): DatabaseType {
    const db = createDb(dbPath);
    activeDbs.push(db);
    return db;
  }

  const dummyProposal: Proposal = {
    id: "prop_mock_test",
    createdAt: new Date().toISOString(),
    total: 39.99,
    status: "approved",
    currency: "USD",
    agentReasoning: "Testing mock adapter persistent storage",
    sourceUrls: ["https://example.com"],
    items: [
      {
        productId: "p1",
        title: "Item 1",
        merchant: "Acme",
        category: "gear",
        unitPrice: 39.99,
        quantity: 1,
        url: "https://example.com/p1",
      },
    ],
    shipTo: {
      name: "Alice",
      line1: "123 Main St",
      city: "Town",
      region: "State",
      postalCode: "12345",
      country: "US",
    },
    policy: {
      decision: "allow",
      results: [],
      evaluatedAt: new Date().toISOString(),
    },
  };

  it("one adapter instance creates an order, a second adapter instance on the same database file authorizes and captures it", async () => {
    const db1 = openDb();
    const adapter1 = new MockPayPalAdapter(db1);
    const order = await adapter1.createOrder(dummyProposal);
    expect(order.orderId).toBeDefined();

    const db2 = openDb();
    const adapter2 = new MockPayPalAdapter(db2);
    const auth = await adapter2.authorizeOrder(order.orderId);
    expect(auth.authorizationId).toBeDefined();
    expect(auth.amount).toBe(39.99);
    expect(auth.currency).toBe("USD");

    const capture = await adapter2.captureAuthorization(auth.authorizationId);
    expect(capture.captureId).toBeDefined();
  });

  it("restart simulation: create an order, build a fresh adapter on the same file, and the order is still found", async () => {
    const dbInitial = openDb();
    const adapterInitial = new MockPayPalAdapter(dbInitial);
    const order = await adapterInitial.createOrder(dummyProposal);

    dbInitial.close();
    activeDbs = activeDbs.filter((d) => d !== dbInitial);

    const dbRestarted = openDb();
    const adapterRestarted = new MockPayPalAdapter(dbRestarted);
    const auth = await adapterRestarted.authorizeOrder(order.orderId);
    expect(auth.authorizationId).toBeDefined();
    expect(auth.amount).toBe(39.99);

    const capture = await adapterRestarted.captureAuthorization(
      auth.authorizationId,
    );
    expect(capture.captureId).toBeDefined();
  });

  it("unknown ids still throw", async () => {
    const db = openDb();
    const adapter = new MockPayPalAdapter(db);

    await expect(adapter.authorizeOrder("ord_nonexistent")).rejects.toThrow(
      "Order ord_nonexistent not found",
    );
    await expect(
      adapter.captureAuthorization("auth_nonexistent"),
    ).rejects.toThrow("Authorization auth_nonexistent not found");
    await expect(adapter.voidAuthorization("auth_nonexistent")).rejects.toThrow(
      "Authorization auth_nonexistent not found",
    );
  });

  it("authorizing the same order twice throws", async () => {
    const db = openDb();
    const adapter = new MockPayPalAdapter(db);
    const order = await adapter.createOrder(dummyProposal);

    await adapter.authorizeOrder(order.orderId);

    await expect(adapter.authorizeOrder(order.orderId)).rejects.toThrow(
      `Order ${order.orderId} has already been authorized`,
    );
  });

  it("a second capture throws", async () => {
    const db = openDb();
    const adapter = new MockPayPalAdapter(db);
    const order = await adapter.createOrder(dummyProposal);
    const auth = await adapter.authorizeOrder(order.orderId);

    await adapter.captureAuthorization(auth.authorizationId);

    await expect(
      adapter.captureAuthorization(auth.authorizationId),
    ).rejects.toThrow(
      `Authorization ${auth.authorizationId} has already been captured`,
    );
  });

  it("voiding then capturing throws", async () => {
    const db = openDb();
    const adapter = new MockPayPalAdapter(db);
    const order = await adapter.createOrder(dummyProposal);
    const auth = await adapter.authorizeOrder(order.orderId);

    await adapter.voidAuthorization(auth.authorizationId);

    await expect(
      adapter.captureAuthorization(auth.authorizationId),
    ).rejects.toThrow(`Authorization ${auth.authorizationId} has been voided`);

    await expect(
      adapter.voidAuthorization(auth.authorizationId),
    ).rejects.toThrow(
      `Authorization ${auth.authorizationId} has already been voided`,
    );
  });

  it("the amount override still works", async () => {
    const db = openDb();
    const adapter = new MockPayPalAdapter(db, {
      authorizeAmountOverride: 88.88,
    });
    const order = await adapter.createOrder(dummyProposal);
    const auth = await adapter.authorizeOrder(order.orderId);

    expect(auth.amount).toBe(88.88);
  });
});
