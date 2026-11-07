import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  type Mandate,
  type ProposalInput,
} from "@leash/shared";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { signMandate } from "../src/mandate/signing.js";
import { saveMandate } from "../src/mandate/storage.js";
import { listAudit } from "../src/audit/storage.js";
import { getProposal } from "../src/proposals/storage.js";
import {
  submitProposal,
  getMandateView,
} from "../src/proposals/service.js";
import { setStatus } from "../src/proposals/transitions.js";
import * as paymentStub from "../src/proposals/payment-stub.js";
import { AppError } from "../src/http/errors.js";

const secret = "test-mandate-secret-key-12345";

describe("proposals service and routes", () => {
  let server: Server;
  let baseUrl: string;
  let db: DatabaseType;

  beforeEach(async () => {
    db = createDb(":memory:");
    const app = createApp(db, { signingSecret: secret });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  function createTestMandate(overrides: Partial<Mandate> = {}): Mandate {
    const unsigned = {
      id: "mand_test_1",
      owner: "Alice",
      currency: "USD" as const,
      totalBudget: 100,
      perItemCap: 60,
      approvalThreshold: 50,
      allowedCategories: ["hiking", "books"],
      allowedMerchants: ["TrailGear", "BookBarn"],
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
      agentReasoning: "Found hiking socks within policy",
      sourceUrls: ["https://trailgear.example/socks"],
      ...overrides,
    };
  }

  it("a valid allowed proposal is stored with status approved, total exact in cents, and audit entries exist", async () => {
    saveMandate(db, createTestMandate());
    const spy = vi.spyOn(paymentStub, "startPayment");

    const proposal = await submitProposal(getValidProposalInput());

    expect(proposal.status).toBe("approved");
    expect(proposal.total).toBe(20);
    expect(spy).toHaveBeenCalledTimes(1);

    const stored = getProposal(db, proposal.id);
    expect(stored).not.toBeNull();
    expect(stored?.total).toBe(20);
    expect(stored?.status).toBe("approved");

    const audits = listAudit(db, 10);
    const received = audits.find((a) => a.event === "proposal_received");
    const decided = audits.find((a) => a.event === "policy_decision");

    expect(received).toBeDefined();
    expect(received?.amount).toBe(20);
    expect(received?.summary).toContain("Hiking Socks");

    expect(decided).toBeDefined();
    expect(decided?.amount).toBe(20);
    expect(decided?.decision).toBe("allow");
  });

  it("accepts unit price of 19.99 and 49.99 and stores exact total in cents", async () => {
    saveMandate(db, createTestMandate({ totalBudget: 200 }));
    const input = getValidProposalInput({
      items: [
        {
          productId: "item-1",
          title: "Book One",
          merchant: "BookBarn",
          category: "books",
          unitPrice: 19.99,
          quantity: 1,
          url: "https://bookbarn.example/1",
        },
        {
          productId: "item-2",
          title: "Book Two",
          merchant: "BookBarn",
          category: "books",
          unitPrice: 49.99,
          quantity: 1,
          url: "https://bookbarn.example/2",
        },
      ],
    });

    const proposal = await submitProposal(input);
    expect(proposal.total).toBe(69.98);
    const stored = getProposal(db, proposal.id);
    expect(stored?.total).toBe(69.98);
  });

  it("stores a proposal above the approval threshold as needs_approval", async () => {
    saveMandate(db, createTestMandate({ approvalThreshold: 50 }));
    const input = getValidProposalInput({
      items: [
        {
          productId: "p1",
          title: "Hiking Backpack",
          merchant: "TrailGear",
          category: "hiking",
          unitPrice: 55,
          quantity: 1,
          url: "https://trailgear.example/pack",
        },
      ],
    });

    const proposal = await submitProposal(input);
    expect(proposal.status).toBe("needs_approval");
    expect(proposal.policy.decision).toBe("ask");
  });

  it("blocks the attack proposal with merchant_allowed, max_quantity, and ship_to_matches failing without calling startPayment", async () => {
    saveMandate(db, createTestMandate());
    const spy = vi.spyOn(paymentStub, "startPayment");

    const attackInput = getValidProposalInput({
      items: [
        {
          productId: "attack-1",
          title: "Cheap Tent",
          merchant: "ShadyMerchant",
          category: "hiking",
          unitPrice: 20,
          quantity: 10,
          url: "https://shady.example/tent",
        },
      ],
      shipTo: {
        name: "Attacker",
        line1: "999 Rogue Way",
        city: "Elsewhere",
        region: "CA",
        postalCode: "90001",
        country: "US",
      },
    });

    const proposal = await submitProposal(attackInput);

    expect(proposal.status).toBe("blocked");
    expect(proposal.policy.decision).toBe("block");
    expect(spy).not.toHaveBeenCalled();

    const merchantRule = proposal.policy.results.find(
      (r) => r.rule === "merchant_allowed",
    );
    const quantityRule = proposal.policy.results.find(
      (r) => r.rule === "max_quantity",
    );
    const shipRule = proposal.policy.results.find(
      (r) => r.rule === "ship_to_matches",
    );

    expect(merchantRule?.passed).toBe(false);
    expect(quantityRule?.passed).toBe(false);
    expect(shipRule?.passed).toBe(false);

    const audits = listAudit(db, 10);
    expect(
      audits.some(
        (a) => a.event === "proposal_received" && a.proposalId === proposal.id,
      ),
    ).toBe(true);
    expect(
      audits.some(
        (a) => a.event === "policy_decision" && a.proposalId === proposal.id,
      ),
    ).toBe(true);
  });

  it("throws no_mandate when no mandate exists", async () => {
    await expect(submitProposal(getValidProposalInput())).rejects.toMatchObject({
      code: "no_mandate",
    });
  });

  it("validation fails on empty items, negative price, 3 decimals, non-integer quantity, missing address fields and stores nothing", async () => {
    saveMandate(db, createTestMandate());

    const badInputs = [
      getValidProposalInput({ items: [] }),
      getValidProposalInput({
        items: [{ ...getValidProposalInput().items[0], unitPrice: -5 }],
      }),
      getValidProposalInput({
        items: [{ ...getValidProposalInput().items[0], unitPrice: 19.999 }],
      }),
      getValidProposalInput({
        items: [{ ...getValidProposalInput().items[0], quantity: 1.5 }],
      }),
      getValidProposalInput({
        shipTo: {
          name: "Alice",
          line1: "",
          city: "Portland",
          region: "OR",
          postalCode: "97201",
          country: "US",
        },
      }),
    ];

    for (const bad of badInputs) {
      await expect(submitProposal(bad)).rejects.toMatchObject({
        code: "validation_error",
      });
    }

    const rowCount = db
      .prepare("SELECT count(*) as count FROM proposals")
      .get() as { count: number };
    expect(rowCount.count).toBe(0);
  });

  it("stores and blocks proposal with currency EUR with currency_match failing rather than validation error", async () => {
    saveMandate(db, createTestMandate());

    const eurInput = getValidProposalInput({ currency: "EUR" as any });
    const proposal = await submitProposal(eurInput);

    expect(proposal.status).toBe("blocked");
    const currencyRule = proposal.policy.results.find(
      (r) => r.rule === "currency_match",
    );
    expect(currencyRule?.passed).toBe(false);

    const stored = getProposal(db, proposal.id);
    expect(stored).not.toBeNull();
    expect(stored?.currency).toBe("EUR");
  });

  it("approving a needs_approval proposal sets approved, writes userDecision and audit, and calls startPayment once", async () => {
    saveMandate(db, createTestMandate({ approvalThreshold: 50 }));
    const spy = vi.spyOn(paymentStub, "startPayment");

    const proposal = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p1",
            title: "Boots",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 55,
            quantity: 1,
            url: "https://trailgear.example/boots",
          },
        ],
      }),
    );
    expect(proposal.status).toBe("needs_approval");
    expect(spy).not.toHaveBeenCalled();

    const res = await fetch(`${baseUrl}/api/proposals/${proposal.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("approved");
    expect(body.userDecision?.action).toBe("approve");
    expect(typeof body.userDecision?.decidedAt).toBe("string");
    expect(spy).toHaveBeenCalledTimes(1);

    const getRes = await fetch(`${baseUrl}/api/proposals/${proposal.id}`);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as any;
    expect(getBody.userDecision?.action).toBe("approve");
    expect(getBody.status).toBe("approved");
    expect(typeof getBody.userDecision?.decidedAt).toBe("string");

    const audits = listAudit(db, 10);
    const userDecAudit = audits.find(
      (a) => a.event === "user_decision" && a.proposalId === proposal.id,
    );
    expect(userDecAudit).toBeDefined();
    expect(userDecAudit?.amount).toBe(55);
  });

  it("rejecting sets rejected and does not call startPayment", async () => {
    saveMandate(db, createTestMandate({ approvalThreshold: 50 }));
    const spy = vi.spyOn(paymentStub, "startPayment");

    const proposal = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p1",
            title: "Boots",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 55,
            quantity: 1,
            url: "https://trailgear.example/boots",
          },
        ],
      }),
    );

    const res = await fetch(`${baseUrl}/api/proposals/${proposal.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("rejected");
    expect(body.userDecision?.action).toBe("reject");
    expect(typeof body.userDecision?.decidedAt).toBe("string");
    expect(spy).not.toHaveBeenCalled();

    const getRes = await fetch(`${baseUrl}/api/proposals/${proposal.id}`);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as any;
    expect(getBody.userDecision?.action).toBe("reject");
    expect(getBody.status).toBe("rejected");
    expect(typeof getBody.userDecision?.decidedAt).toBe("string");
  });

  it("deciding twice returns invalid_state the second time", async () => {
    saveMandate(db, createTestMandate({ approvalThreshold: 50 }));
    const proposal = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p1",
            title: "Boots",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 55,
            quantity: 1,
            url: "https://trailgear.example/boots",
          },
        ],
      }),
    );

    const first = await fetch(
      `${baseUrl}/api/proposals/${proposal.id}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      },
    );
    expect(first.status).toBe(200);

    const second = await fetch(
      `${baseUrl}/api/proposals/${proposal.id}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      },
    );
    expect(second.status).toBe(409);
    const err = (await second.json()) as any;
    expect(err.error.code).toBe("invalid_state");
  });

  it("deciding on a blocked proposal returns invalid_state", async () => {
    saveMandate(db, createTestMandate());
    const proposal = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p1",
            title: "Shady Item",
            merchant: "UnknownMerchant",
            category: "hiking",
            unitPrice: 10,
            quantity: 1,
            url: "https://unknown.example",
          },
        ],
      }),
    );
    expect(proposal.status).toBe("blocked");

    const res = await fetch(`${baseUrl}/api/proposals/${proposal.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(res.status).toBe(409);
    const err = (await res.json()) as any;
    expect(err.error.code).toBe("invalid_state");
  });

  it("deciding on an unknown id returns not_found", async () => {
    const res = await fetch(`${baseUrl}/api/proposals/prop_unknown/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(res.status).toBe(404);
    const err = (await res.json()) as any;
    expect(err.error.code).toBe("not_found");
  });

  it("the transition table rejects blocked to approved and captured to voided", () => {
    expect(() => setStatus("blocked", "approved")).toThrow(AppError);
    try {
      setStatus("blocked", "approved");
    } catch (err: any) {
      expect(err.code).toBe("invalid_state");
    }

    expect(() => setStatus("captured", "voided")).toThrow(AppError);
    try {
      setStatus("captured", "voided");
    } catch (err: any) {
      expect(err.code).toBe("invalid_state");
    }
  });

  it("GET /api/proposals returns proposals newest first", async () => {
    saveMandate(db, createTestMandate({ totalBudget: 500 }));

    const p1 = await submitProposal(
      getValidProposalInput({ agentReasoning: "First" }),
    );
    const p2 = await submitProposal(
      getValidProposalInput({ agentReasoning: "Second" }),
    );
    const p3 = await submitProposal(
      getValidProposalInput({ agentReasoning: "Third" }),
    );

    const res = await fetch(`${baseUrl}/api/proposals`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as any[];
    expect(list.length).toBe(3);
    expect(list[0].id).toBe(p3.id);
    expect(list[1].id).toBe(p2.id);
    expect(list[2].id).toBe(p1.id);

    const singleRes = await fetch(`${baseUrl}/api/proposals/${p2.id}`);
    expect(singleRes.status).toBe(200);
    const single = (await singleRes.json()) as any;
    expect(single.id).toBe(p2.id);

    const notFoundRes = await fetch(`${baseUrl}/api/proposals/prop_fake`);
    expect(notFoundRes.status).toBe(404);
  });

  it("a tampered stored mandate makes new proposals blocked with signature_valid failing", async () => {
    saveMandate(db, createTestMandate());

    db.prepare(
      "UPDATE mandate SET signature = '0000000000000000000000000000000000000000000000000000000000000000' WHERE 1=1",
    ).run();

    const proposal = await submitProposal(getValidProposalInput());
    expect(proposal.status).toBe("blocked");
    const sigRule = proposal.policy.results.find(
      (r) => r.rule === "signature_valid",
    );
    expect(sigRule?.passed).toBe(false);
  });

  it("getMandateView returns MandateView when mandate exists and null when absent", async () => {
    expect(getMandateView()).toBeNull();

    saveMandate(db, createTestMandate({ totalBudget: 100 }));
    const view = getMandateView();
    expect(view).not.toBeNull();
    expect(view?.totalBudget).toBe(100);
    expect(view?.spent).toBe(0);
    expect(view?.remaining).toBe(100);
    expect("signature" in (view as any)).toBe(false);
  });

  it("POST /api/proposals returns 404 or 405", async () => {
    saveMandate(db, createTestMandate());
    const res = await fetch(`${baseUrl}/api/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getValidProposalInput()),
    });
    expect([404, 405]).toContain(res.status);
  });

  it("userDecision is stored and returned by GET /api/proposals/:id after an approve and after a reject", async () => {
    saveMandate(db, createTestMandate({ approvalThreshold: 50 }));

    const proposalApprove = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p1",
            title: "Boots",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 55,
            quantity: 1,
            url: "https://trailgear.example/boots",
          },
        ],
      }),
    );
    await fetch(`${baseUrl}/api/proposals/${proposalApprove.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });

    const resApprove = await fetch(
      `${baseUrl}/api/proposals/${proposalApprove.id}`,
    );
    expect(resApprove.status).toBe(200);
    const bodyApprove = (await resApprove.json()) as any;
    expect(bodyApprove.userDecision?.action).toBe("approve");
    expect(bodyApprove.status).toBe("approved");
    expect(typeof bodyApprove.userDecision?.decidedAt).toBe("string");

    const proposalReject = await submitProposal(
      getValidProposalInput({
        items: [
          {
            productId: "p2",
            title: "Poles",
            merchant: "TrailGear",
            category: "hiking",
            unitPrice: 55,
            quantity: 1,
            url: "https://trailgear.example/poles",
          },
        ],
      }),
    );
    await fetch(`${baseUrl}/api/proposals/${proposalReject.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });

    const resReject = await fetch(
      `${baseUrl}/api/proposals/${proposalReject.id}`,
    );
    expect(resReject.status).toBe(200);
    const bodyReject = (await resReject.json()) as any;
    expect(bodyReject.userDecision?.action).toBe("reject");
    expect(bodyReject.status).toBe("rejected");
    expect(typeof bodyReject.userDecision?.decidedAt).toBe("string");
  });

  it("boundary check fails when agent code imports anything forbidden from proposals folder", async () => {
    const checkPath = "../../boundary-check.mjs";
    const { checkAgentSource } = (await import(checkPath)) as {
      checkAgentSource: (code: string) => string[];
    };

    const bad1 = checkAgentSource(
      'import { initProposalService } from "../proposals/service.js";',
    );
    expect(bad1.length).toBeGreaterThan(0);
    expect(bad1[0]).toContain('Forbidden specifier "initProposalService"');

    const bad2 = checkAgentSource(
      'import { setStatus } from "../proposals/transitions.js";',
    );
    expect(bad2.length).toBeGreaterThan(0);
    expect(bad2[0]).toContain("Forbidden import of proposals internals");

    const bad3 = checkAgentSource(
      'import { startPayment } from "../proposals/payment-stub.js";',
    );
    expect(bad3.length).toBeGreaterThan(0);
    expect(bad3[0]).toContain("Forbidden import of proposals internals");

    const bad4 = checkAgentSource(
      'import * as service from "../proposals/service.js";',
    );
    expect(bad4.length).toBeGreaterThan(0);
    expect(bad4[0]).toContain("Forbidden namespace import");

    const bad5 = checkAgentSource(
      'import service from "../proposals/service.js";',
    );
    expect(bad5.length).toBeGreaterThan(0);
    expect(bad5[0]).toContain("Forbidden default import");

    const ok = checkAgentSource(
      'import { submitProposal, getMandateView } from "../proposals/service.js";',
    );
    expect(ok.length).toBe(0);
  });
});
