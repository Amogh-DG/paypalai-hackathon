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
import { getSpent } from "../src/proposals/spent.js";
import {
  MockPayPalAdapter,
  type PayPalAdapter,
} from "../src/paypal/index.js";

const secret = "test-mandate-secret-key-12345";

describe("paypal return and cancel flows", () => {
  let server: Server;
  let baseUrl: string;
  let db: DatabaseType;
  let adapter: MockPayPalAdapter;
  let currentTime: Date;

  const clock = () => currentTime;

  beforeEach(async () => {
    db = createDb(":memory:");
    adapter = new MockPayPalAdapter();
    currentTime = new Date("2026-11-08T12:00:00Z");

    const app = createApp(db, {
      signingSecret: secret,
      paypalAdapter: adapter,
      paypalMode: "mock",
      clock,
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
      id: "mand_ret_1",
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
      expiresAt: new Date("2026-11-09T12:00:00Z").toISOString(),
      createdAt: new Date("2026-11-07T12:00:00Z").toISOString(),
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
      agentReasoning: "Standard proposal",
      sourceUrls: ["https://trailgear.example/socks"],
      ...overrides,
    };
  }

  it("happy path: allowed proposal ends captured with full sequential audit trail", async () => {
    saveMandate(db, createTestMandate());
    const proposal = await submitProposal(getValidProposalInput());
    expect(proposal.status).toBe("awaiting_buyer");
    const token = proposal.payment?.orderId!;

    const approveRes = await fetch(
      `${baseUrl}/api/mock/paypal/approve?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(approveRes.status).toBe(302);

    const returnRes = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(returnRes.status).toBe(302);
    expect(returnRes.headers.get("location")).toBe(`/?proposal=${proposal.id}`);

    const finalProposal = getProposal(db, proposal.id);
    expect(finalProposal?.status).toBe("captured");
    expect(finalProposal?.payment?.authorizationId).toBeDefined();
    expect(finalProposal?.payment?.captureId).toBeDefined();

    const audits = listAudit(db, 50).filter(
      (a) => a.proposalId === proposal.id,
    );
    const chronological = [...audits].reverse();
    const eventSequence = chronological.map((a) => a.event);

    expect(eventSequence).toEqual([
      "proposal_received",
      "policy_decision",
      "order_created",
      "buyer_approved",
      "authorized",
      "webhook",
      "recheck",
      "captured",
      "webhook",
    ]);

    const firstWebhook = chronological.find(
      (a, i) => a.event === "webhook" && i === 5,
    );
    expect(firstWebhook?.summary).toBe("PAYMENT.AUTHORIZATION.CREATED");
    expect(firstWebhook?.details.mode).toBe("mock");

    const secondWebhook = chronological.find(
      (a, i) => a.event === "webhook" && i === 8,
    );
    expect(secondWebhook?.summary).toBe("PAYMENT.CAPTURE.COMPLETED");
  });

  it("an above-threshold proposal that the user approved ends captured", async () => {
    saveMandate(db, createTestMandate({ approvalThreshold: 30 }));
    const proposal = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p1",
            title: "Boots",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 40,
            quantity: 1,
            url: "https://trailgear.example/boots",
          },
        ],
      }),
    );
    expect(proposal.status).toBe("needs_approval");

    const decRes = await fetch(
      `${baseUrl}/api/proposals/${proposal.id}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      },
    );
    expect(decRes.status).toBe(200);
    const approvedProposal = (await decRes.json()) as any;
    expect(approvedProposal.status).toBe("awaiting_buyer");

    const token = approvedProposal.payment.orderId;
    const returnRes = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(returnRes.status).toBe(302);

    const finalProposal = getProposal(db, proposal.id);
    expect(finalProposal?.status).toBe("captured");

    const audits = listAudit(db, 20);
    const recheckAudit = audits.find(
      (a) => a.proposalId === proposal.id && a.event === "recheck",
    );
    expect(recheckAudit?.decision).toBe("allow");
  });

  it("amount mismatch results in voided with no capture and amount named in recheck", async () => {
    saveMandate(db, createTestMandate());
    adapter.setAuthorizeAmountOverride(99.99);

    let captureCalled = false;
    const origCapture = adapter.captureAuthorization.bind(adapter);
    adapter.captureAuthorization = async (id: string) => {
      captureCalled = true;
      return origCapture(id);
    };

    const proposal = await submitProposal(getValidProposalInput());
    const token = proposal.payment?.orderId!;

    const returnRes = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(returnRes.status).toBe(302);

    const finalProposal = getProposal(db, proposal.id);
    expect(finalProposal?.status).toBe("voided");
    expect(finalProposal?.payment?.captureId).toBeUndefined();
    expect(captureCalled).toBe(false);

    const audits = listAudit(db, 20);
    const recheckAudit = audits.find(
      (a) => a.proposalId === proposal.id && a.event === "recheck",
    );
    expect(recheckAudit?.decision).toBe("block");
    expect(recheckAudit?.summary).toContain("99.99");
    expect(audits.some((a) => a.event === "captured")).toBe(false);

    const voidWebhook = audits.find(
      (a) =>
        a.event === "webhook" &&
        a.summary === "PAYMENT.AUTHORIZATION.VOIDED",
    );
    expect(voidWebhook).toBeDefined();
  });

  it("mandate replaced mid-flow with smaller budget results in voided with within_budget named", async () => {
    saveMandate(db, createTestMandate({ totalBudget: 100 }));
    const proposal = await submitProposal(getValidProposalInput());
    const token = proposal.payment?.orderId!;

    saveMandate(db, createTestMandate({ totalBudget: 10 }));

    const returnRes = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(returnRes.status).toBe(302);

    const finalProposal = getProposal(db, proposal.id);
    expect(finalProposal?.status).toBe("voided");

    const audits = listAudit(db, 20);
    const voidAudit = audits.find(
      (a) => a.proposalId === proposal.id && a.event === "voided",
    );
    expect(voidAudit?.summary).toContain("budget");
  });

  it("mandate replaced mid-flow with different shipping address results in voided with ship_to_matches named", async () => {
    saveMandate(db, createTestMandate());
    const proposal = await submitProposal(getValidProposalInput());
    const token = proposal.payment?.orderId!;

    saveMandate(
      db,
      createTestMandate({
        shippingAddress: {
          name: "Alice Smith",
          line1: "999 New Road",
          city: "Seattle",
          region: "WA",
          postalCode: "98101",
          country: "US",
        },
      }),
    );

    const returnRes = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(returnRes.status).toBe(302);

    const finalProposal = getProposal(db, proposal.id);
    expect(finalProposal?.status).toBe("voided");

    const audits = listAudit(db, 20);
    const voidAudit = audits.find(
      (a) => a.proposalId === proposal.id && a.event === "voided",
    );
    expect(voidAudit?.summary.toLowerCase()).toContain("ship-to");
  });

  it("mandate replaced mid-flow with allowed-merchants that excludes merchant results in voided", async () => {
    saveMandate(db, createTestMandate());
    const proposal = await submitProposal(getValidProposalInput());
    const token = proposal.payment?.orderId!;

    saveMandate(db, createTestMandate({ allowedMerchants: ["OtherMerchant"] }));

    const returnRes = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(returnRes.status).toBe(302);

    const finalProposal = getProposal(db, proposal.id);
    expect(finalProposal?.status).toBe("voided");
  });

  it("no mandate at return time results in voided", async () => {
    saveMandate(db, createTestMandate());
    const proposal = await submitProposal(getValidProposalInput());
    const token = proposal.payment?.orderId!;

    db.prepare("DELETE FROM mandate").run();

    const returnRes = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(returnRes.status).toBe(302);

    const finalProposal = getProposal(db, proposal.id);
    expect(finalProposal?.status).toBe("voided");

    const audits = listAudit(db, 20);
    const voidAudit = audits.find(
      (a) => a.proposalId === proposal.id && a.event === "voided",
    );
    expect(voidAudit?.summary).toContain("No mandate found");
  });

  it("mandate expired before return results in voided with not_expired named", async () => {
    saveMandate(
      db,
      createTestMandate({ expiresAt: "2026-11-08T14:00:00Z" }),
    );
    const proposal = await submitProposal(getValidProposalInput());
    const token = proposal.payment?.orderId!;

    currentTime = new Date("2026-11-08T15:00:00Z");

    const returnRes = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(returnRes.status).toBe(302);

    const finalProposal = getProposal(db, proposal.id);
    expect(finalProposal?.status).toBe("voided");

    const audits = listAudit(db, 20);
    const voidAudit = audits.find(
      (a) => a.proposalId === proposal.id && a.event === "voided",
    );
    expect(voidAudit?.summary).toContain("expired");
  });

  it("threshold lowered mid-flow on allowed proposal voids it, but captures on user-approved proposal", async () => {
    saveMandate(db, createTestMandate({ approvalThreshold: 50 }));

    const pAllow = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p1",
            title: "Item 1",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 20,
            quantity: 1,
            url: "https://trailgear.example/1",
          },
        ],
      }),
    );
    expect(pAllow.status).toBe("awaiting_buyer");
    const tokenAllow = pAllow.payment?.orderId!;

    saveMandate(db, createTestMandate({ approvalThreshold: 10 }));

    const resAllow = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${pAllow.id}&token=${tokenAllow}`,
      { redirect: "manual" },
    );
    expect(resAllow.status).toBe(302);
    expect(getProposal(db, pAllow.id)?.status).toBe("voided");

    saveMandate(
      db,
      createTestMandate({ approvalThreshold: 50, totalBudget: 200 }),
    );

    const pApprove = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p2",
            title: "Item 2",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 55,
            quantity: 1,
            url: "https://trailgear.example/2",
          },
        ],
      }),
    );
    expect(pApprove.status).toBe("needs_approval");

    const decRes = await fetch(
      `${baseUrl}/api/proposals/${pApprove.id}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      },
    );
    const approvedBody = (await decRes.json()) as any;
    const tokenApprove = approvedBody.payment.orderId;

    saveMandate(
      db,
      createTestMandate({ approvalThreshold: 10, totalBudget: 200 }),
    );

    const resApprove = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${pApprove.id}&token=${tokenApprove}`,
      { redirect: "manual" },
    );
    expect(resApprove.status).toBe(302);
    expect(getProposal(db, pApprove.id)?.status).toBe("captured");
  });

  it("tampered stored mandate signature at return time voids with signature_valid named", async () => {
    saveMandate(db, createTestMandate());
    const proposal = await submitProposal(getValidProposalInput());
    const token = proposal.payment?.orderId!;

    db.prepare(
      "UPDATE mandate SET signature = '0000000000000000000000000000000000000000000000000000000000000000' WHERE 1=1",
    ).run();

    const returnRes = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(returnRes.status).toBe(302);

    const finalProposal = getProposal(db, proposal.id);
    expect(finalProposal?.status).toBe("voided");

    const audits = listAudit(db, 20);
    const voidAudit = audits.find(
      (a) => a.proposalId === proposal.id && a.event === "voided",
    );
    expect(voidAudit?.summary).toContain("signature");
  });

  it("budget exclusion prevents self-double-counting at return time", async () => {
    saveMandate(db, createTestMandate({ totalBudget: 80 }));

    const pA = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p1",
            title: "A",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 40,
            quantity: 1,
            url: "https://trailgear.example/a",
          },
        ],
      }),
    );
    const tokenA = pA.payment?.orderId!;
    await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${pA.id}&token=${tokenA}`,
      { redirect: "manual" },
    );
    expect(getProposal(db, pA.id)?.status).toBe("captured");

    const pB = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p2",
            title: "B",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 40,
            quantity: 1,
            url: "https://trailgear.example/b",
          },
        ],
      }),
    );
    expect(pB.status).toBe("awaiting_buyer");
    const tokenB = pB.payment?.orderId!;

    await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${pB.id}&token=${tokenB}`,
      { redirect: "manual" },
    );
    expect(getProposal(db, pB.id)?.status).toBe("captured");

    const pC = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p3",
            title: "C",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 40,
            quantity: 1,
            url: "https://trailgear.example/c",
          },
        ],
      }),
    );
    expect(pC.status).toBe("blocked");
    expect(
      pC.policy.results.find((r) => r.rule === "within_budget")?.passed,
    ).toBe(false);
  });

  it("idempotency: sequential and concurrent return calls result in exactly one authorization and capture", async () => {
    saveMandate(db, createTestMandate());

    let authorizeCalls = 0;
    let captureCalls = 0;

    const countingAdapter: PayPalAdapter = {
      mode: "mock",
      async createOrder(p: Proposal) {
        return adapter.createOrder(p);
      },
      async authorizeOrder(id: string) {
        authorizeCalls++;
        return adapter.authorizeOrder(id);
      },
      async captureAuthorization(id: string) {
        captureCalls++;
        return adapter.captureAuthorization(id);
      },
      async voidAuthorization(id: string) {
        return adapter.voidAuthorization(id);
      },
    };

    const app = createApp(db, {
      signingSecret: secret,
      paypalAdapter: countingAdapter,
      paypalMode: "mock",
      clock,
    });

    const localServer = app.listen(0);
    const localPort = (localServer.address() as AddressInfo).port;

    try {
      const proposal = await submitProposal(getValidProposalInput());
      const token = proposal.payment?.orderId!;

      const [res1, res2] = await Promise.all([
        fetch(
          `http://localhost:${localPort}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
          { redirect: "manual" },
        ),
        fetch(
          `http://localhost:${localPort}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
          { redirect: "manual" },
        ),
      ]);

      expect(res1.status).toBe(302);
      expect(res2.status).toBe(302);

      const resSequential = await fetch(
        `http://localhost:${localPort}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
        { redirect: "manual" },
      );
      expect(resSequential.status).toBe(302);

      expect(authorizeCalls).toBe(1);
      expect(captureCalls).toBe(1);

      const audits = listAudit(db, 30).filter(
        (a) => a.proposalId === proposal.id,
      );
      const captureAudits = audits.filter((a) => a.event === "captured");
      expect(captureAudits.length).toBe(1);
    } finally {
      localServer.close();
    }
  });

  it("return endpoint error responses for wrong token, unknown proposal, and blocked proposal", async () => {
    saveMandate(db, createTestMandate());
    const proposal = await submitProposal(getValidProposalInput());
    const correctToken = proposal.payment?.orderId!;

    let authorizeCalls = 0;
    let captureCalls = 0;
    let voidCalls = 0;
    adapter.authorizeOrder = async () => {
      authorizeCalls++;
      return { authorizationId: "auth_test", amount: 20, currency: "USD" };
    };
    adapter.captureAuthorization = async () => {
      captureCalls++;
      return { captureId: "cap_test" };
    };
    adapter.voidAuthorization = async () => {
      voidCalls++;
    };

    const auditsBefore = listAudit(db, 50).filter(
      (a) => a.proposalId === proposal.id,
    );

    const resWrong = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposal.id}&token=wrong_tok`,
    );
    expect(resWrong.status).toBe(400);

    const currentProposal = getProposal(db, proposal.id);
    expect(currentProposal?.status).toBe("awaiting_buyer");
    expect(authorizeCalls).toBe(0);
    expect(captureCalls).toBe(0);
    expect(voidCalls).toBe(0);

    const auditsAfter = listAudit(db, 50).filter(
      (a) => a.proposalId === proposal.id,
    );
    expect(auditsAfter.length).toBe(auditsBefore.length);

    const resUnknown = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=prop_nonexistent&token=${correctToken}`,
    );
    expect(resUnknown.status).toBe(404);
    const unknownBody = (await resUnknown.json()) as any;
    expect(unknownBody.error.code).toBe("not_found");

    const attackProposal = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p1",
            title: "Bad",
            merchant: "BadMerchant",
            category: "hiking",
            unitPrice: 10,
            quantity: 1,
            url: "https://bad.example",
          },
        ],
      }),
    );
    expect(attackProposal.status).toBe("blocked");

    const resBlocked = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${attackProposal.id}&token=fake_tok`,
    );
    expect(resBlocked.status).toBe(409);
    const blockedBody = (await resBlocked.json()) as any;
    expect(blockedBody.error.code).toBe("invalid_state");
  });

  it("cancel endpoint voids awaiting_buyer, ignores other states, and is idempotent", async () => {
    saveMandate(db, createTestMandate());

    let authorizeCalled = false;
    const origAuthorize = adapter.authorizeOrder.bind(adapter);
    adapter.authorizeOrder = async (orderId: string) => {
      authorizeCalled = true;
      return origAuthorize(orderId);
    };

    const proposal = await submitProposal(getValidProposalInput());
    expect(proposal.status).toBe("awaiting_buyer");

    const cancelRes = await fetch(
      `${baseUrl}/api/paypal/cancel?proposalId=${proposal.id}`,
      { redirect: "manual" },
    );
    expect(cancelRes.status).toBe(302);
    expect(cancelRes.headers.get("location")).toBe(`/?proposal=${proposal.id}`);
    expect(authorizeCalled).toBe(false);

    expect(getProposal(db, proposal.id)?.status).toBe("voided");

    const audits = listAudit(db, 20);
    const cancelAudit = audits.find(
      (a) => a.proposalId === proposal.id && a.event === "voided",
    );
    expect(cancelAudit?.summary).toBe("Buyer cancelled at PayPal");
    expect(audits.some((a) => a.event === "webhook")).toBe(false);

    const cancelAgain = await fetch(
      `${baseUrl}/api/paypal/cancel?proposalId=${proposal.id}`,
      { redirect: "manual" },
    );
    expect(cancelAgain.status).toBe(302);

    const proposalCaptured = await submitProposal(getValidProposalInput());
    const token = proposalCaptured.payment?.orderId!;
    await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposalCaptured.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(getProposal(db, proposalCaptured.id)?.status).toBe("captured");

    const cancelCaptured = await fetch(
      `${baseUrl}/api/paypal/cancel?proposalId=${proposalCaptured.id}`,
      { redirect: "manual" },
    );
    expect(cancelCaptured.status).toBe(302);
    expect(getProposal(db, proposalCaptured.id)?.status).toBe("captured");
  });

  it("handles exceptions: authorizeOrder failure and captureAuthorization failure", async () => {
    saveMandate(db, createTestMandate());

    const failingAuthAdapter: PayPalAdapter = {
      mode: "mock",
      async createOrder(p: Proposal) {
        return adapter.createOrder(p);
      },
      async authorizeOrder() {
        throw new Error("Authorization network failure");
      },
      async captureAuthorization(id: string) {
        return adapter.captureAuthorization(id);
      },
      async voidAuthorization(id: string) {
        return adapter.voidAuthorization(id);
      },
    };

    const app1 = createApp(db, {
      signingSecret: secret,
      paypalAdapter: failingAuthAdapter,
      paypalMode: "mock",
      clock,
    });

    const server1 = app1.listen(0);
    const port1 = (server1.address() as AddressInfo).port;

    try {
      const p1 = await submitProposal(getValidProposalInput());
      const token1 = p1.payment?.orderId!;

      const res1 = await fetch(
        `http://localhost:${port1}/api/paypal/return?proposalId=${p1.id}&token=${token1}`,
        { redirect: "manual" },
      );
      expect(res1.status).toBe(302);

      const stored1 = getProposal(db, p1.id);
      expect(stored1?.status).toBe("failed");

      const audits1 = listAudit(db, 20);
      const errAudit = audits1.find(
        (a) => a.proposalId === p1.id && a.event === "error",
      );
      expect(errAudit?.summary).toContain("Authorization network failure");
    } finally {
      server1.close();
    }

    let voidAttempted = false;
    const failingCaptureAdapter: PayPalAdapter = {
      mode: "mock",
      async createOrder(p: Proposal) {
        return adapter.createOrder(p);
      },
      async authorizeOrder(id: string) {
        return adapter.authorizeOrder(id);
      },
      async captureAuthorization() {
        throw new Error("Capture service failure");
      },
      async voidAuthorization(id: string) {
        voidAttempted = true;
        return adapter.voidAuthorization(id);
      },
    };

    const app2 = createApp(db, {
      signingSecret: secret,
      paypalAdapter: failingCaptureAdapter,
      paypalMode: "mock",
      clock,
    });

    const server2 = app2.listen(0);
    const port2 = (server2.address() as AddressInfo).port;

    try {
      const p2 = await submitProposal(getValidProposalInput());
      const token2 = p2.payment?.orderId!;

      const res2 = await fetch(
        `http://localhost:${port2}/api/paypal/return?proposalId=${p2.id}&token=${token2}`,
        { redirect: "manual" },
      );
      expect(res2.status).toBe(302);

      const stored2 = getProposal(db, p2.id);
      expect(stored2?.status).toBe("failed");
      expect(voidAttempted).toBe(true);

      const audits2 = listAudit(db, 20);
      const errAudit2 = audits2.find(
        (a) => a.proposalId === p2.id && a.event === "error",
      );
      expect(errAudit2?.summary).toContain("Capture service failure");
      expect(errAudit2?.details.voidAttempt).toBe("Void succeeded");
    } finally {
      server2.close();
    }
  });

  it("voided and failed proposals no longer count toward spent while captured does", async () => {
    saveMandate(db, createTestMandate({ totalBudget: 100 }));

    const pCap = await submitProposal(getValidProposalInput());
    const tokenCap = pCap.payment?.orderId!;
    await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${pCap.id}&token=${tokenCap}`,
      { redirect: "manual" },
    );
    expect(getProposal(db, pCap.id)?.status).toBe("captured");
    expect(getSpent(db)).toBe(20);

    const pCancel = await submitProposal(getValidProposalInput());
    expect(getSpent(db)).toBe(40);
    await fetch(`${baseUrl}/api/paypal/cancel?proposalId=${pCancel.id}`, {
      redirect: "manual",
    });
    expect(getProposal(db, pCancel.id)?.status).toBe("voided");
    expect(getSpent(db)).toBe(20);

    const pFail = await submitProposal(getValidProposalInput());
    expect(getSpent(db)).toBe(40);
    db.prepare("UPDATE proposals SET status = 'failed' WHERE id = ?").run(
      pFail.id,
    );
    expect(getProposal(db, pFail.id)?.status).toBe("failed");
    expect(getSpent(db)).toBe(20);
  });

  it("the return redirect goes to /?proposal={id} in every case, including already-processed proposals", async () => {
    saveMandate(db, createTestMandate());
    const proposal = await submitProposal(getValidProposalInput());
    const token = proposal.payment?.orderId!;

    const firstReturnRes = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(firstReturnRes.status).toBe(302);
    expect(firstReturnRes.headers.get("location")).toBe(
      `/?proposal=${proposal.id}`,
    );
    expect(getProposal(db, proposal.id)?.status).toBe("captured");

    const secondReturnRes = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${proposal.id}&token=${token}`,
      { redirect: "manual" },
    );
    expect(secondReturnRes.status).toBe(302);
    expect(secondReturnRes.headers.get("location")).toBe(
      `/?proposal=${proposal.id}`,
    );

    const pVoid = await submitProposal(getValidProposalInput());
    const tokenVoid = pVoid.payment?.orderId!;
    adapter.setAuthorizeAmountOverride(99.99);

    const voidReturnRes = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${pVoid.id}&token=${tokenVoid}`,
      { redirect: "manual" },
    );
    expect(voidReturnRes.status).toBe(302);
    expect(voidReturnRes.headers.get("location")).toBe(
      `/?proposal=${pVoid.id}`,
    );
    expect(getProposal(db, pVoid.id)?.status).toBe("voided");

    const voidReturnAgain = await fetch(
      `${baseUrl}/api/paypal/return?proposalId=${pVoid.id}&token=${tokenVoid}`,
      { redirect: "manual" },
    );
    expect(voidReturnAgain.status).toBe(302);
    expect(voidReturnAgain.headers.get("location")).toBe(
      `/?proposal=${pVoid.id}`,
    );
  });
});
