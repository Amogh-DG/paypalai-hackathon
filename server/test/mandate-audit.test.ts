import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  centsToDollars,
  dollarsToCents,
  hasAtMostTwoDecimals,
} from "@leash/shared";
import { verifyMandate } from "../src/mandate/signing.js";
import { writeAudit } from "../src/audit/index.js";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";

const secret = "test-mandate-secret-key-12345";

describe("hasAtMostTwoDecimals", () => {
  it("accepts values with at most two decimal places", () => {
    expect(hasAtMostTwoDecimals(19.99)).toBe(true);
    expect(hasAtMostTwoDecimals(1.15)).toBe(true);
    expect(hasAtMostTwoDecimals(0.07)).toBe(true);
    expect(hasAtMostTwoDecimals(49.99)).toBe(true);
    expect(
      hasAtMostTwoDecimals(centsToDollars(dollarsToCents(0.1 + 0.2))),
    ).toBe(true);
    expect(hasAtMostTwoDecimals(80)).toBe(true);
  });

  it("rejects values with more than two decimal places, NaN, and Infinity", () => {
    expect(hasAtMostTwoDecimals(19.999)).toBe(false);
    expect(hasAtMostTwoDecimals(0.001)).toBe(false);
    expect(hasAtMostTwoDecimals(NaN)).toBe(false);
    expect(hasAtMostTwoDecimals(Infinity)).toBe(false);
  });
});

describe("mandate and audit endpoints", () => {
  let server: Server;
  let baseUrl: string;
  let db: DatabaseType;

  beforeEach(async () => {
    db = createDb(":memory:");
    const app = createApp(db, {
      signingSecret: secret,
      beforeErrorRoutes: (a) => {
        a.get("/api/test-unexpected-error", () => {
          throw new Error("Secret internal failure detail");
        });
      },
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

  function getValidMandateInput() {
    return {
      owner: "Alice",
      currency: "USD",
      totalBudget: 80,
      perItemCap: 60,
      approvalThreshold: 50,
      allowedCategories: ["  Hiking  ", "BOOKS"],
      allowedMerchants: [" TrailGear "],
      maxQuantityPerItem: 2,
      shippingAddress: {
        name: "Alice",
        line1: "123 Trail Way",
        city: "Portland",
        region: "OR",
        postalCode: "97201",
        country: "US",
      },
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
  }

  it("creating a valid mandate returns 201 with an id starting mand_, a signature, and categories normalized", async () => {
    const input = getValidMandateInput();
    const res = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.id.startsWith("mand_")).toBe(true);
    expect(typeof body.signature).toBe("string");
    expect(body.signature).toHaveLength(64);
    expect(body.allowedCategories).toEqual(["hiking", "books"]);
    expect(body.allowedMerchants).toEqual(["TrailGear"]);

    expect(verifyMandate(body, secret)).toBe(true);
  });

  it("a second POST replaces the first and GET returns only the new one", async () => {
    const firstInput = getValidMandateInput();
    await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(firstInput),
    });

    const secondInput = {
      ...getValidMandateInput(),
      owner: "Bob",
      totalBudget: 150,
    };
    const resPost2 = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(secondInput),
    });
    expect(resPost2.status).toBe(201);
    const body2 = (await resPost2.json()) as any;
    expect(body2.owner).toBe("Bob");

    const resGet = await fetch(`${baseUrl}/api/mandate`);
    expect(resGet.status).toBe(200);
    const getView = (await resGet.json()) as any;
    expect(getView.owner).toBe("Bob");
    expect(getView.totalBudget).toBe(150);
    expect(getView.id).toBe(body2.id);
  });

  it("GET with no mandate returns 404 no_mandate", async () => {
    const res = await fetch(`${baseUrl}/api/mandate`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("no_mandate");
  });

  it("GET never contains a signature field", async () => {
    const input = getValidMandateInput();
    await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const res = await fetch(`${baseUrl}/api/mandate`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect("signature" in body).toBe(false);
    expect(body.spent).toBe(0);
    expect(body.remaining).toBe(80);
  });

  it("returns 400 validation_error for negative budget", async () => {
    const input = { ...getValidMandateInput(), totalBudget: -10 };
    const res = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("totalBudget");
  });

  it("returns 400 validation_error for unknown category such as gifts", async () => {
    const input = { ...getValidMandateInput(), allowedCategories: ["gifts"] };
    const res = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("allowedCategories");
  });

  it("returns 400 validation_error for empty merchants", async () => {
    const input = { ...getValidMandateInput(), allowedMerchants: [] };
    const res = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("allowedMerchants");
  });

  it("returns 400 validation_error for expiry in the past", async () => {
    const input = {
      ...getValidMandateInput(),
      expiresAt: new Date(Date.now() - 10000).toISOString(),
    };
    const res = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("expiresAt");
  });

  it("returns 400 validation_error for a missing address field", async () => {
    const input = getValidMandateInput();
    const { line1: _line1, ...incompleteAddress } = input.shippingAddress;
    const res = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, shippingAddress: incompleteAddress }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("line1");
  });

  it("returns 400 validation_error for currency EUR", async () => {
    const input = { ...getValidMandateInput(), currency: "EUR" };
    const res = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("currency");
  });

  it("accepts mandate with per-item cap 49.99, approval threshold 19.99, and budget 80 returning 201", async () => {
    const input = {
      ...getValidMandateInput(),
      perItemCap: 49.99,
      approvalThreshold: 19.99,
      totalBudget: 80,
    };
    const res = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.perItemCap).toBe(49.99);
    expect(body.approvalThreshold).toBe(19.99);
    expect(body.totalBudget).toBe(80);
  });

  it("returns 400 validation_error for a budget of 80.001", async () => {
    const input = { ...getValidMandateInput(), totalBudget: 80.001 };
    const res = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("totalBudget");
  });

  it("returns 400 validation_error for a budget with three decimals", async () => {
    const input = { ...getValidMandateInput(), totalBudget: 80.123 };
    const res = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("totalBudget");
  });

  it("returns 400 validation_error for quantity 0", async () => {
    const input = { ...getValidMandateInput(), maxQuantityPerItem: 0 };
    const res = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("maxQuantityPerItem");
  });

  it("audit entries come back newest first, respect limit, and limit 0 or 5000 gives validation_error", async () => {
    writeAudit(db, {
      event: "proposal_received",
      summary: "First entry",
      details: { step: 1 },
    });
    writeAudit(db, {
      event: "policy_decision",
      summary: "Second entry",
      details: { step: 2 },
    });
    writeAudit(db, {
      event: "order_created",
      summary: "Third entry",
      details: { step: 3 },
    });

    const resLimit2 = await fetch(`${baseUrl}/api/audit?limit=2`);
    expect(resLimit2.status).toBe(200);
    const entries = (await resLimit2.json()) as any[];
    expect(entries).toHaveLength(2);
    expect(entries[0].summary).toBe("Third entry");
    expect(entries[1].summary).toBe("Second entry");
    expect(entries[0].id.startsWith("aud_")).toBe(true);

    const resLimit0 = await fetch(`${baseUrl}/api/audit?limit=0`);
    expect(resLimit0.status).toBe(400);
    const body0 = (await resLimit0.json()) as any;
    expect(body0.error.code).toBe("validation_error");

    const resLimit5000 = await fetch(`${baseUrl}/api/audit?limit=5000`);
    expect(resLimit5000.status).toBe(400);
    const body5000 = (await resLimit5000.json()) as any;
    expect(body5000.error.code).toBe("validation_error");
  });

  it("an unexpected thrown error returns internal_error with no stack trace in the body", async () => {
    const res = await fetch(`${baseUrl}/api/test-unexpected-error`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).toBe("An internal server error occurred");
    expect("stack" in body).toBe(false);
    expect("stack" in body.error).toBe(false);
    expect(JSON.stringify(body)).not.toContain("Secret internal failure detail");
  });
});
