import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  type Mandate,
  type Proposal,
  type ProposalInput,
} from "@leash/shared";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { signMandate } from "../src/mandate/signing.js";
import { saveMandate } from "../src/mandate/storage.js";
import { listAudit } from "../src/audit/storage.js";
import { getProposal } from "../src/proposals/storage.js";
import { submitProposal } from "../src/proposals/service.js";
import { startPayment } from "../src/proposals/payment.js";
import {
  MockPayPalAdapter,
  type PayPalAdapter,
} from "../src/paypal/index.js";
import { AppError } from "../src/http/errors.js";

const secret = "test-mandate-secret-key-12345";

describe("paypal adapter and payment flow", () => {
  let server: Server;
  let baseUrl: string;
  let db: DatabaseType;
  let adapter: MockPayPalAdapter;

  beforeEach(async () => {
    db = createDb(":memory:");
    adapter = new MockPayPalAdapter();
    const app = createApp(db, {
      signingSecret: secret,
      paypalAdapter: adapter,
      paypalMode: "mock",
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  function createTestMandate(overrides: Partial<Mandate> = {}): Mandate {
    const unsigned = {
      id: "mand_pay_1",
      owner: "Alice",
      currency: "USD" as const,
      totalBudget: 100,
      perItemCap: 60,
      approvalThreshold: 50,
      allowedCategories: ["hiking", "books"],
      allowedMerchants: ["TrailGear"],
      maxQuantityPerItem: 2,
      shippingAddress: {
        name: "Alice Smith",
        line1: "123 Trail Way",
        city: "Portland",
        region: "OR",
        postalCode: "97201",
        country: "US",
      },
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString(),
      ...overrides,
    };
    const signature = signMandate(unsigned, secret);
    return { ...unsigned, signature };
  }

  function getValidProposalInput(
    overrides: Partial<ProposalInput> = {},
  ): ProposalInput {
    return {
      items: [
        {
          productId: "p1",
          title: "Hiking Socks",
          merchant: "TrailGear",
          category: "hiking",
          unitPrice: 20,
          quantity: 1,
          url: "https://trailgear.example/socks",
        },
      ],
      shipTo: {
        name: "Alice Smith",
        line1: "123 Trail Way",
        city: "Portland",
        region: "OR",
        postalCode: "97201",
        country: "US",
      },
      currency: "USD",
      agentReasoning: "Standard allowed proposal",
      sourceUrls: ["https://trailgear.example/socks"],
      ...overrides,
    };
  }

  it("an allowed proposal ends awaiting_buyer with payment mode mock, an orderId, approveUrl, and order_created audit", async () => {
    saveMandate(db, createTestMandate());

    const proposal = await submitProposal(getValidProposalInput());

    expect(proposal.status).toBe("awaiting_buyer");
    expect(proposal.payment).toBeDefined();
    expect(proposal.payment?.mode).toBe("mock");
    expect(typeof proposal.payment?.orderId).toBe("string");
    expect(proposal.payment?.orderId?.startsWith("ord_")).toBe(true);
    expect(proposal.payment?.approveUrl).toContain(
      `/api/mock/paypal/approve?proposalId=${proposal.id}&token=${proposal.payment?.orderId}`,
    );

    const stored = getProposal(db, proposal.id);
    expect(stored?.status).toBe("awaiting_buyer");
    expect(stored?.payment?.orderId).toBe(proposal.payment?.orderId);

    const audits = listAudit(db, 20);
    const orderCreated = audits.find((a) => a.event === "order_created");
    expect(orderCreated).toBeDefined();
    expect(orderCreated?.proposalId).toBe(proposal.id);
    expect(orderCreated?.amount).toBe(20);
    expect(orderCreated?.details.orderId).toBe(proposal.payment?.orderId);
  });

  it("a blocked proposal never calls createOrder, so no order exists", async () => {
    saveMandate(db, createTestMandate());

    let createOrderCalled = false;
    const trackingAdapter: PayPalAdapter = {
      async createOrder(p: Proposal) {
        createOrderCalled = true;
        return adapter.createOrder(p);
      },
      async authorizeOrder(id: string) {
        return adapter.authorizeOrder(id);
      },
      async captureAuthorization(id: string) {
        return adapter.captureAuthorization(id);
      },
      async voidAuthorization(id: string) {
        return adapter.voidAuthorization(id);
      },
    };

    createApp(db, {
      signingSecret: secret,
      paypalAdapter: trackingAdapter,
      paypalMode: "mock",
    });

    const attackInput = getValidProposalInput({
      items: [
        {
          productId: "p1",
          title: "Blocked Item",
          merchant: "BadMerchant",
          category: "hiking",
          unitPrice: 20,
          quantity: 1,
          url: "https://bad.example",
        },
      ],
    });

    const proposal = await submitProposal(attackInput);

    expect(proposal.status).toBe("blocked");
    expect(proposal.payment).toBeUndefined();
    expect(createOrderCalled).toBe(false);

    const audits = listAudit(db, 20);
    expect(
      audits.some(
        (a) =>
          ["order_created", "authorized", "captured"].includes(a.event) &&
          a.proposalId === proposal.id,
      ),
    ).toBe(false);
  });

  it("a needs_approval proposal creates no order until it is approved, and after approval ends awaiting_buyer", async () => {
    saveMandate(db, createTestMandate({ approvalThreshold: 30 }));

    let createOrderCalls = 0;
    const trackingAdapter: PayPalAdapter = {
      async createOrder(p: Proposal) {
        createOrderCalls++;
        return adapter.createOrder(p);
      },
      async authorizeOrder(id: string) {
        return adapter.authorizeOrder(id);
      },
      async captureAuthorization(id: string) {
        return adapter.captureAuthorization(id);
      },
      async voidAuthorization(id: string) {
        return adapter.voidAuthorization(id);
      },
    };

    const app = createApp(db, {
      signingSecret: secret,
      paypalAdapter: trackingAdapter,
      paypalMode: "mock",
    });

    const localServer = app.listen(0);
    const localPort = (localServer.address() as AddressInfo).port;

    try {
      const askInput = getValidProposalInput({
        items: [
          {
            productId: "p1",
            title: "Pricey Gear",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 40,
            quantity: 1,
            url: "https://trailgear.example/pricey",
          },
        ],
      });

      const proposal = await submitProposal(askInput);
      expect(proposal.status).toBe("needs_approval");
      expect(proposal.payment).toBeUndefined();
      expect(createOrderCalls).toBe(0);

      const decisionRes = await fetch(
        `http://localhost:${localPort}/api/proposals/${proposal.id}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        },
      );

      expect(decisionRes.status).toBe(200);
      const approvedBody = (await decisionRes.json()) as any;
      expect(approvedBody.status).toBe("awaiting_buyer");
      expect(approvedBody.payment?.mode).toBe("mock");
      expect(typeof approvedBody.payment?.orderId).toBe("string");
      expect(createOrderCalls).toBe(1);

      const stored = getProposal(db, proposal.id);
      expect(stored?.status).toBe("awaiting_buyer");
      expect(stored?.payment?.orderId).toBe(approvedBody.payment?.orderId);
    } finally {
      localServer.close();
    }
  });

  it("a rejected proposal creates no order", async () => {
    saveMandate(db, createTestMandate({ approvalThreshold: 30 }));

    let createOrderCalls = 0;
    const trackingAdapter: PayPalAdapter = {
      async createOrder(p: Proposal) {
        createOrderCalls++;
        return adapter.createOrder(p);
      },
      async authorizeOrder(id: string) {
        return adapter.authorizeOrder(id);
      },
      async captureAuthorization(id: string) {
        return adapter.captureAuthorization(id);
      },
      async voidAuthorization(id: string) {
        return adapter.voidAuthorization(id);
      },
    };

    const app = createApp(db, {
      signingSecret: secret,
      paypalAdapter: trackingAdapter,
      paypalMode: "mock",
    });

    const localServer = app.listen(0);
    const localPort = (localServer.address() as AddressInfo).port;

    try {
      const askInput = getValidProposalInput({
        items: [
          {
            productId: "p1",
            title: "Pricey Gear",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 40,
            quantity: 1,
            url: "https://trailgear.example/pricey",
          },
        ],
      });

      const proposal = await submitProposal(askInput);
      expect(proposal.status).toBe("needs_approval");

      const decisionRes = await fetch(
        `http://localhost:${localPort}/api/proposals/${proposal.id}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reject" }),
        },
      );

      expect(decisionRes.status).toBe(200);
      const rejectedBody = (await decisionRes.json()) as any;
      expect(rejectedBody.status).toBe("rejected");
      expect(createOrderCalls).toBe(0);

      const stored = getProposal(db, proposal.id);
      expect(stored?.status).toBe("rejected");
      expect(stored?.payment).toBeUndefined();
    } finally {
      localServer.close();
    }
  });

  it("if createOrder throws, the proposal ends failed and an error audit entry exists", async () => {
    saveMandate(db, createTestMandate());

    const failingAdapter: PayPalAdapter = {
      async createOrder() {
        throw new Error("Simulated PayPal outage");
      },
      async authorizeOrder() {
        throw new Error("Not implemented");
      },
      async captureAuthorization() {
        throw new Error("Not implemented");
      },
      async voidAuthorization() {
        throw new Error("Not implemented");
      },
    };

    createApp(db, {
      signingSecret: secret,
      paypalAdapter: failingAdapter,
      paypalMode: "mock",
    });

    const proposal = await submitProposal(getValidProposalInput());

    expect(proposal.status).toBe("failed");
    const stored = getProposal(db, proposal.id);
    expect(stored?.status).toBe("failed");

    const audits = listAudit(db, 10);
    const errorAudit = audits.find((a) => a.event === "error");
    expect(errorAudit).toBeDefined();
    expect(errorAudit?.proposalId).toBe(proposal.id);
    expect(errorAudit?.summary).toContain("Simulated PayPal outage");
  });

  it("startPayment on a blocked proposal throws invalid_state and creates nothing", async () => {
    saveMandate(db, createTestMandate());

    const attackInput = getValidProposalInput({
      items: [
        {
          productId: "p1",
          title: "Blocked Item",
          merchant: "BadMerchant",
          category: "hiking",
          unitPrice: 20,
          quantity: 1,
          url: "https://bad.example",
        },
      ],
    });

    const proposal = await submitProposal(attackInput);
    expect(proposal.status).toBe("blocked");

    await expect(startPayment(proposal)).rejects.toThrow(AppError);
    try {
      await startPayment(proposal);
    } catch (err: any) {
      expect(err.code).toBe("invalid_state");
    }

    const stored = getProposal(db, proposal.id);
    expect(stored?.status).toBe("blocked");
    expect(stored?.payment).toBeUndefined();
  });

  it("the mock approve endpoint with a wrong token or an unknown proposal returns an error and writes no audit entry", async () => {
    saveMandate(db, createTestMandate());
    const proposal = await submitProposal(getValidProposalInput());
    expect(proposal.status).toBe("awaiting_buyer");

    const resUnknown = await fetch(
      `${baseUrl}/api/mock/paypal/approve?proposalId=prop_nonexistent&token=tok_123`,
    );
    expect(resUnknown.status).toBe(404);
    const bodyUnknown = (await resUnknown.json()) as any;
    expect(bodyUnknown.error.code).toBe("not_found");

    const resWrongToken = await fetch(
      `${baseUrl}/api/mock/paypal/approve?proposalId=${proposal.id}&token=wrong_token`,
    );
    expect(resWrongToken.status).toBe(400);
    const bodyWrong = (await resWrongToken.json()) as any;
    expect(bodyWrong.error.code).toBe("validation_error");

    const audits = listAudit(db, 20);
    expect(audits.some((a) => a.event === "buyer_approved")).toBe(false);
  });

  it("the mock approve endpoint redirects to return URL with right query values when token matches", async () => {
    saveMandate(db, createTestMandate());
    const proposal = await submitProposal(getValidProposalInput());
    const token = proposal.payment?.orderId!;

    const res = await fetch(
      `${baseUrl}/api/mock/paypal/approve?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe(
      `/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
    );

    const audits = listAudit(db, 10);
    const approvedAudit = audits.find((a) => a.event === "buyer_approved");
    expect(approvedAudit).toBeDefined();
    expect(approvedAudit?.proposalId).toBe(proposal.id);
    expect(approvedAudit?.amount).toBe(proposal.total);
    expect(approvedAudit?.details.orderId).toBe(token);
  });

  it("with PAYPAL_MODE sandbox the app refuses to start with a clear message", () => {
    expect(() => {
      createApp(db, {
        signingSecret: secret,
        paypalMode: "sandbox",
      });
    }).toThrow("PayPal sandbox mode is not implemented yet");
  });

  it("the mock adapter throws on unknown ids and on a second capture", async () => {
    const mock = new MockPayPalAdapter();

    await expect(mock.authorizeOrder("ord_fake")).rejects.toThrow(
      "Order ord_fake not found",
    );
    await expect(mock.captureAuthorization("auth_fake")).rejects.toThrow(
      "Authorization auth_fake not found",
    );
    await expect(mock.voidAuthorization("auth_fake")).rejects.toThrow(
      "Authorization auth_fake not found",
    );

    const dummyProposal: Proposal = {
      id: "prop_test_mock",
      createdAt: new Date().toISOString(),
      total: 45,
      status: "approved",
      currency: "USD",
      agentReasoning: "Test reasoning",
      sourceUrls: [],
      items: [],
      shipTo: {
        name: "Alice",
        line1: "123",
        city: "Portland",
        region: "OR",
        postalCode: "97201",
        country: "US",
      },
      policy: {
        decision: "allow",
        results: [],
        evaluatedAt: new Date().toISOString(),
      },
    };

    const order = await mock.createOrder(dummyProposal);
    expect(order.orderId).toBeDefined();
    expect(order.approveUrl).toContain(order.orderId);

    const auth = await mock.authorizeOrder(order.orderId);
    expect(auth.authorizationId).toBeDefined();
    expect(auth.amount).toBe(45);
    expect(auth.currency).toBe("USD");

    const capture = await mock.captureAuthorization(auth.authorizationId);
    expect(capture.captureId).toBeDefined();

    await expect(
      mock.captureAuthorization(auth.authorizationId),
    ).rejects.toThrow("already been captured");
  });

  it("mock adapter supports test override for authorizeOrder amount", async () => {
    const mock = new MockPayPalAdapter({ authorizeAmountOverride: 99.99 });

    const dummyProposal: Proposal = {
      id: "prop_test_override",
      createdAt: new Date().toISOString(),
      total: 45,
      status: "approved",
      currency: "USD",
      agentReasoning: "Test reasoning",
      sourceUrls: [],
      items: [],
      shipTo: {
        name: "Alice",
        line1: "123",
        city: "Portland",
        region: "OR",
        postalCode: "97201",
        country: "US",
      },
      policy: {
        decision: "allow",
        results: [],
        evaluatedAt: new Date().toISOString(),
      },
    };

    const order = await mock.createOrder(dummyProposal);
    const auth = await mock.authorizeOrder(order.orderId);
    expect(auth.amount).toBe(99.99);
  });
});
