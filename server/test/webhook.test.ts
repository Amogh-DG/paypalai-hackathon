import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Database as DatabaseType } from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { SandboxPayPalAdapter } from "../src/paypal/sandbox.js";
import { saveProposal } from "../src/proposals/storage.js";
import { listAudit } from "../src/audit/storage.js";
import { signMandate, saveMandate } from "../src/mandate/index.js";
import type { Proposal, Mandate } from "@leash/shared";

describe("PayPal Webhook Route", () => {
  let db: DatabaseType;
  let server: Server;
  let baseUrl: string;
  let fakeFetchRequests: Array<{ url: string; init?: RequestInit }> = [];
  let verificationStatus = "SUCCESS";
  const signingSecret = "test-signing-secret-webhook";
  const testWebhookId = "WH-TEST-ID-123";

  function createFakeFetch(): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      fakeFetchRequests.push({ url, init });

      if (url.endsWith("/v1/oauth2/token")) {
        return new Response(
          JSON.stringify({
            access_token: "fake_token_123",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
        return new Response(
          JSON.stringify({
            verification_status: verificationStatus,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not found", { status: 404 });
    };
  }

  function setupApp(mode: "sandbox" | "mock" = "sandbox", webhookIdEnv = testWebhookId): Promise<void> {
    db = createDb(":memory:");
    process.env.PAYPAL_WEBHOOK_ID = webhookIdEnv;

    const fakeFetch = createFakeFetch();
    const sandboxAdapter = new SandboxPayPalAdapter({
      clientId: "fake_client_id",
      clientSecret: "fake_client_secret",
      fetchFn: fakeFetch,
    });

    const app = createApp(db, {
      signingSecret,
      paypalMode: mode,
      paypalAdapter: mode === "sandbox" ? sandboxAdapter : undefined,
    });

    return new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  }

  beforeEach(() => {
    fakeFetchRequests = [];
    verificationStatus = "SUCCESS";
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    delete process.env.PAYPAL_WEBHOOK_ID;
  });

  function standardHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.paypal.com/v1/notifications/certs/CERT-123",
      "paypal-transmission-id": "trans-123",
      "paypal-transmission-sig": "fake_sig_base64",
      "paypal-transmission-time": "2026-11-08T10:00:00Z",
    };
  }

  function createProposalFixture(overrides: Partial<Proposal> = {}): Proposal {
    return {
      id: "prop_wh_test_1",
      createdAt: new Date().toISOString(),
      total: 49.99,
      status: "authorized",
      currency: "USD",
      agentReasoning: "Buying boots",
      items: [
        {
          productId: "p1",
          title: "Boots",
          merchant: "TrailGear",
          category: "hiking",
          unitPrice: 49.99,
          quantity: 1,
          url: "https://example.com/p1",
        },
      ],
      shipTo: {
        name: "Alice",
        line1: "123 Main St",
        city: "Seattle",
        region: "WA",
        postalCode: "98101",
        country: "US",
      },
      sourceUrls: ["https://example.com/p1"],
      policy: {
        decision: "allow",
        results: [],
        evaluatedAt: new Date().toISOString(),
      },
      payment: {
        mode: "sandbox",
        orderId: "ord_paypal_100",
        authorizationId: "auth_paypal_200",
      },
      ...overrides,
    };
  }

  it("returns 404 in mock mode", async () => {
    await setupApp("mock");

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify({ id: "WH-1", event_type: "PAYMENT.AUTHORIZATION.CREATED" }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({
      error: {
        code: "not_found",
        message: expect.any(String),
      },
    });
  });

  it("returns generic 500 when PAYPAL_WEBHOOK_ID is missing in sandbox mode", async () => {
    await setupApp("sandbox", "");

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify({ id: "WH-1", event_type: "PAYMENT.AUTHORIZATION.CREATED" }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({
      error: {
        code: "internal_error",
        message: "An internal server error occurred",
      },
    });

    const entries = listAudit(db, 10);
    expect(entries.length).toBe(0);
  });

  it("returns 400 when transmission headers are missing", async () => {
    await setupApp("sandbox");

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "paypal-auth-algo": "SHA256withRSA",
      },
      body: JSON.stringify({ id: "WH-1", event_type: "PAYMENT.AUTHORIZATION.CREATED" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({
      error: {
        code: "validation_error",
        message: expect.any(String),
      },
    });

    const entries = listAudit(db, 10);
    expect(entries.length).toBe(0);
  });

  it("returns 400 when body is malformed", async () => {
    await setupApp("sandbox");

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: "invalid-not-json{",
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({
      error: {
        code: "validation_error",
        message: expect.any(String),
      },
    });

    const entries = listAudit(db, 10);
    expect(entries.length).toBe(0);
  });

  it("returns 400 and writes no audit entry when verification fails", async () => {
    await setupApp("sandbox");
    verificationStatus = "FAILURE";

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify({
        id: "WH-FAIL-1",
        event_type: "PAYMENT.AUTHORIZATION.CREATED",
        resource: { id: "auth_test_1" },
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({
      error: {
        code: "validation_error",
        message: expect.any(String),
      },
    });

    const entries = listAudit(db, 10);
    expect(entries.length).toBe(0);
  });

  it("passes raw body bytes to verify call exactly as received", async () => {
    await setupApp("sandbox");

    const rawEventPayload = '{\n  "id": "WH-RAW-999",\n  "event_type": "PAYMENT.AUTHORIZATION.CREATED",\n  "resource": {\n    "id": "auth_raw_1"\n  }\n}';

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: rawEventPayload,
    });

    expect(res.status).toBe(200);

    const verifyCall = fakeFetchRequests.find((r) =>
      r.url.endsWith("/v1/notifications/verify-webhook-signature"),
    );
    expect(verifyCall).toBeDefined();
    const verifyBody = String(verifyCall?.init?.body);
    expect(verifyBody).toContain(rawEventPayload);
  });

  it("writes one webhook audit entry for verified authorization-created and changes nothing else", async () => {
    await setupApp("sandbox");
    const proposal = createProposalFixture();
    saveProposal(db, proposal);

    const eventPayload = {
      id: "WH-AUTH-100",
      event_type: "PAYMENT.AUTHORIZATION.CREATED",
      resource: {
        id: "auth_paypal_200",
        supplementary_data: {
          related_ids: {
            order_id: "ord_paypal_100",
          },
        },
      },
    };

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify(eventPayload),
    });

    expect(res.status).toBe(200);

    const updatedRow = db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposal.id) as {
      status: string;
      payment: string;
    };
    expect(updatedRow.status).toBe("authorized");
    const pay = JSON.parse(updatedRow.payment);
    expect(pay.authorizationId).toBe("auth_paypal_200");
    expect(pay.orderId).toBe("ord_paypal_100");

    const entries = listAudit(db, 10);
    expect(entries.length).toBe(1);
    expect(entries[0].event).toBe("webhook");
    expect(entries[0].proposalId).toBe(proposal.id);
    expect(entries[0].summary).toContain("PAYMENT.AUTHORIZATION.CREATED");
    expect(entries[0].summary).toContain(proposal.id);
    expect(entries[0].details).toMatchObject({
      eventType: "PAYMENT.AUTHORIZATION.CREATED",
      eventId: "WH-AUTH-100",
      mode: "sandbox",
    });
  });

  it("fills in a missing capture id for capture-completed and leaves status untouched", async () => {
    await setupApp("sandbox");
    const proposal = createProposalFixture({
      payment: {
        mode: "sandbox",
        orderId: "ord_paypal_100",
        authorizationId: "auth_paypal_200",
      },
    });
    saveProposal(db, proposal);

    const eventPayload = {
      id: "WH-CAP-200",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "cap_paypal_300",
        supplementary_data: {
          related_ids: {
            order_id: "ord_paypal_100",
            authorization_id: "auth_paypal_200",
          },
        },
      },
    };

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify(eventPayload),
    });

    expect(res.status).toBe(200);

    const updatedRow = db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposal.id) as {
      status: string;
      payment: string;
    };
    expect(updatedRow.status).toBe("authorized");
    const pay = JSON.parse(updatedRow.payment);
    expect(pay.captureId).toBe("cap_paypal_300");
    expect(pay.authorizationId).toBe("auth_paypal_200");
    expect(pay.orderId).toBe("ord_paypal_100");

    const entries = listAudit(db, 10);
    expect(entries.length).toBe(1);
    expect(entries[0].event).toBe("webhook");
    expect(entries[0].proposalId).toBe(proposal.id);
    expect(entries[0].summary).toContain("PAYMENT.CAPTURE.COMPLETED");
  });

  it("never overwrites an existing capture id", async () => {
    await setupApp("sandbox");
    const proposal = createProposalFixture({
      payment: {
        mode: "sandbox",
        orderId: "ord_paypal_100",
        authorizationId: "auth_paypal_200",
        captureId: "existing_capture_id",
      },
    });
    saveProposal(db, proposal);

    const eventPayload = {
      id: "WH-CAP-201",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "new_capture_id_diff",
        supplementary_data: {
          related_ids: {
            order_id: "ord_paypal_100",
          },
        },
      },
    };

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify(eventPayload),
    });

    expect(res.status).toBe(200);

    const updatedRow = db.prepare("SELECT payment FROM proposals WHERE id = ?").get(proposal.id) as {
      payment: string;
    };
    const pay = JSON.parse(updatedRow.payment);
    expect(pay.captureId).toBe("existing_capture_id");
  });

  it("never changes proposal status, including a voided event for a captured proposal", async () => {
    await setupApp("sandbox");
    const proposal = createProposalFixture({
      status: "captured",
      payment: {
        mode: "sandbox",
        orderId: "ord_paypal_100",
        authorizationId: "auth_paypal_200",
        captureId: "cap_paypal_300",
      },
    });
    saveProposal(db, proposal);

    const eventPayload = {
      id: "WH-VOID-300",
      event_type: "PAYMENT.AUTHORIZATION.VOIDED",
      resource: {
        id: "auth_paypal_200",
        supplementary_data: {
          related_ids: {
            order_id: "ord_paypal_100",
          },
        },
      },
    };

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify(eventPayload),
    });

    expect(res.status).toBe(200);

    const updatedRow = db.prepare("SELECT status FROM proposals WHERE id = ?").get(proposal.id) as {
      status: string;
    };
    expect(updatedRow.status).toBe("captured");

    const entries = listAudit(db, 10);
    expect(entries.length).toBe(1);
    expect(entries[0].event).toBe("webhook");
    expect(entries[0].proposalId).toBe(proposal.id);
    expect(entries[0].summary).toContain("PAYMENT.AUTHORIZATION.VOIDED");
  });

  it("duplicate delivery of same event id writes nothing new and returns 200", async () => {
    await setupApp("sandbox");
    const proposal = createProposalFixture();
    saveProposal(db, proposal);

    const eventPayload = {
      id: "WH-DUP-1",
      event_type: "PAYMENT.AUTHORIZATION.CREATED",
      resource: {
        id: "auth_paypal_200",
        supplementary_data: {
          related_ids: {
            order_id: "ord_paypal_100",
          },
        },
      },
    };

    const res1 = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify(eventPayload),
    });
    expect(res1.status).toBe(200);

    const entries1 = listAudit(db, 10);
    expect(entries1.length).toBe(1);

    const res2 = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify(eventPayload),
    });
    expect(res2.status).toBe(200);

    const entries2 = listAudit(db, 10);
    expect(entries2.length).toBe(1);
  });

  it("writes one unmatched audit entry when verified event matches no proposal", async () => {
    await setupApp("sandbox");

    const eventPayload = {
      id: "WH-UNKNOWN-ORD",
      event_type: "PAYMENT.AUTHORIZATION.CREATED",
      resource: {
        id: "auth_unknown_999",
        supplementary_data: {
          related_ids: {
            order_id: "ord_unknown_999",
          },
        },
      },
    };

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify(eventPayload),
    });

    expect(res.status).toBe(200);

    const entries = listAudit(db, 10);
    expect(entries.length).toBe(1);
    expect(entries[0].event).toBe("webhook");
    expect(entries[0].proposalId).toBeUndefined();
    expect(entries[0].summary).toContain("unmatched");
    expect(entries[0].summary).toContain("PAYMENT.AUTHORIZATION.CREATED");
  });

  it("writes one ignored audit entry for unknown event type and returns 200", async () => {
    await setupApp("sandbox");

    const eventPayload = {
      id: "WH-OTHER-TYPE",
      event_type: "CUSTOMER.DISPUTE.CREATED",
      resource: {
        id: "dispute_123",
      },
    };

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify(eventPayload),
    });

    expect(res.status).toBe(200);

    const entries = listAudit(db, 10);
    expect(entries.length).toBe(1);
    expect(entries[0].event).toBe("webhook");
    expect(entries[0].proposalId).toBeUndefined();
    expect(entries[0].summary).toContain("ignored");
    expect(entries[0].summary).toContain("CUSTOMER.DISPUTE.CREATED");
  });

  it("other routes still parse JSON normally", async () => {
    await setupApp("sandbox");

    const mandateInput = {
      owner: "Alice",
      currency: "USD" as const,
      totalBudget: 200,
      perItemCap: 100,
      approvalThreshold: 80,
      allowedCategories: ["hiking"],
      allowedMerchants: ["TrailGear"],
      maxQuantityPerItem: 3,
      shippingAddress: {
        name: "Alice",
        line1: "123 Main St",
        city: "Seattle",
        region: "WA",
        postalCode: "98101",
        country: "US",
      },
      expiresAt: "2028-01-01T00:00:00.000Z",
    };

    const res = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mandateInput),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as Mandate;
    expect(json.owner).toBe("Alice");
    expect(json.signature).toBeDefined();
  });

  it("builds two apps in same process with separate databases and adapters and writes only to its own database", async () => {
    process.env.PAYPAL_WEBHOOK_ID = testWebhookId;
    const db1 = createDb(":memory:");
    const db2 = createDb(":memory:");

    const prop1 = createProposalFixture({
      id: "prop_app_1",
      payment: {
        mode: "sandbox",
        orderId: "ord_app_1",
      },
    });
    const prop2 = createProposalFixture({
      id: "prop_app_2",
      payment: {
        mode: "sandbox",
        orderId: "ord_app_2",
      },
    });
    saveProposal(db1, prop1);
    saveProposal(db2, prop2);

    const adapter1 = new SandboxPayPalAdapter({
      clientId: "id1",
      clientSecret: "sec1",
      fetchFn: createFakeFetch(),
    });
    const adapter2 = new SandboxPayPalAdapter({
      clientId: "id2",
      clientSecret: "sec2",
      fetchFn: createFakeFetch(),
    });

    const app1 = createApp(db1, {
      signingSecret: "secret1",
      paypalMode: "sandbox",
      paypalAdapter: adapter1,
    });
    const app2 = createApp(db2, {
      signingSecret: "secret2",
      paypalMode: "sandbox",
      paypalAdapter: adapter2,
    });

    let server1!: Server;
    let server2!: Server;
    let url1 = "";
    let url2 = "";

    await new Promise<void>((resolve) => {
      server1 = app1.listen(0, "127.0.0.1", () => {
        url1 = `http://127.0.0.1:${(server1.address() as AddressInfo).port}`;
        resolve();
      });
    });
    await new Promise<void>((resolve) => {
      server2 = app2.listen(0, "127.0.0.1", () => {
        url2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
        resolve();
      });
    });

    try {
      const res1 = await fetch(`${url1}/api/paypal/webhook`, {
        method: "POST",
        headers: standardHeaders(),
        body: JSON.stringify({
          id: "WH-APP-1",
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          resource: {
            id: "cap_app_1",
            supplementary_data: {
              related_ids: { order_id: "ord_app_1" },
            },
          },
        }),
      });
      expect(res1.status).toBe(200);

      const res2 = await fetch(`${url2}/api/paypal/webhook`, {
        method: "POST",
        headers: standardHeaders(),
        body: JSON.stringify({
          id: "WH-APP-2",
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          resource: {
            id: "cap_app_2",
            supplementary_data: {
              related_ids: { order_id: "ord_app_2" },
            },
          },
        }),
      });
      expect(res2.status).toBe(200);

      const audit1 = listAudit(db1, 10);
      const audit2 = listAudit(db2, 10);

      expect(audit1.length).toBe(1);
      expect(audit1[0].proposalId).toBe("prop_app_1");
      expect(audit1[0].details).toMatchObject({ eventId: "WH-APP-1" });

      expect(audit2.length).toBe(1);
      expect(audit2[0].proposalId).toBe("prop_app_2");
      expect(audit2[0].details).toMatchObject({ eventId: "WH-APP-2" });

      const updatedProp1 = db1.prepare("SELECT payment FROM proposals WHERE id = ?").get("prop_app_1") as { payment: string };
      expect(JSON.parse(updatedProp1.payment).captureId).toBe("cap_app_1");

      const updatedProp2 = db2.prepare("SELECT payment FROM proposals WHERE id = ?").get("prop_app_2") as { payment: string };
      expect(JSON.parse(updatedProp2.payment).captureId).toBe("cap_app_2");

      const dupCheck1 = db1.prepare("SELECT event_id FROM processed_webhook_events WHERE event_id = ?").get("WH-APP-2");
      expect(dupCheck1).toBeUndefined();

      const dupCheck2 = db2.prepare("SELECT event_id FROM processed_webhook_events WHERE event_id = ?").get("WH-APP-1");
      expect(dupCheck2).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => server1.close(() => resolve()));
      await new Promise<void>((resolve) => server2.close(() => resolve()));
    }
  });

  it("rolls back transaction on failure so event id is not recorded as processed and returns 500", async () => {
    await setupApp("sandbox");
    const proposal = createProposalFixture();
    saveProposal(db, proposal);

    db.exec(`
      CREATE TRIGGER fail_audit_insert
      BEFORE INSERT ON audit_entries
      WHEN NEW.event = 'webhook'
      BEGIN
        SELECT RAISE(FAIL, 'Simulated audit insertion failure');
      END;
    `);

    const eventPayload = {
      id: "WH-FAIL-TX-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "cap_fail_tx",
        supplementary_data: {
          related_ids: { order_id: "ord_paypal_100" },
        },
      },
    };

    const res = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify(eventPayload),
    });

    expect(res.status).toBe(500);

    const processedRow = db
      .prepare("SELECT event_id FROM processed_webhook_events WHERE event_id = ?")
      .get("WH-FAIL-TX-1");
    expect(processedRow).toBeUndefined();

    const proposalRow = db
      .prepare("SELECT payment FROM proposals WHERE id = ?")
      .get(proposal.id) as { payment: string };
    const pay = JSON.parse(proposalRow.payment);
    expect(pay.captureId).toBeUndefined();

    db.exec("DROP TRIGGER fail_audit_insert;");

    const retryRes = await fetch(`${baseUrl}/api/paypal/webhook`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify(eventPayload),
    });
    expect(retryRes.status).toBe(200);

    const processedAfterRetry = db
      .prepare("SELECT event_id FROM processed_webhook_events WHERE event_id = ?")
      .get("WH-FAIL-TX-1");
    expect(processedAfterRetry).toBeDefined();

    const proposalAfterRetry = db
      .prepare("SELECT payment FROM proposals WHERE id = ?")
      .get(proposal.id) as { payment: string };
    expect(JSON.parse(proposalAfterRetry.payment).captureId).toBe("cap_fail_tx");
  });
});
