import { describe, it, expect, vi } from "vitest";
import type { Proposal } from "@leash/shared";
import {
  SandboxPayPalAdapter,
  PayPalApiError,
  createPayPalAdapter,
  MockPayPalAdapter,
} from "../src/paypal/index.js";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { submitProposal } from "../src/proposals/service.js";
import { saveMandate, signMandate } from "../src/mandate/index.js";

function makeProposal(
  overrides?: Partial<Proposal>,
  itemOverrides?: Array<{ unitPrice: number; quantity: number }>,
): Proposal {
  const items = itemOverrides
    ? itemOverrides.map((io, idx) => ({
        productId: `prod_${idx}`,
        title: `Item ${idx}`,
        merchant: "Trailhead Supply",
        category: "hiking",
        unitPrice: io.unitPrice,
        quantity: io.quantity,
        url: "https://example.com/item",
      }))
    : [
        {
          productId: "prod_1",
          title: "Hiking Poles",
          merchant: "Trailhead Supply",
          category: "hiking",
          unitPrice: 25.0,
          quantity: 1,
          url: "https://example.com/poles",
        },
      ];

  const total =
    overrides?.total ??
    items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  return {
    id: "prop_test_123",
    createdAt: new Date().toISOString(),
    total,
    status: "approved",
    currency: "USD",
    agentReasoning: "Test proposal reasoning",
    items,
    shipTo: {
      name: "Rohan Verma",
      line1: "100 Feet Road, Indiranagar",
      city: "Bengaluru",
      region: "Karnataka",
      postalCode: "560038",
      country: "India",
    },
    sourceUrls: ["https://example.com"],
    policy: {
      decision: "allow",
      results: [],
      evaluatedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

describe("PayPal Sandbox Adapter", () => {
  it("requests token once, reuses across calls, and refreshes after expiry", async () => {
    let tokenRequests = 0;
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v1/oauth2/token")) {
        tokenRequests++;
        return new Response(
          JSON.stringify({
            access_token: `token_${tokenRequests}`,
            token_type: "Bearer",
            expires_in: 2,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (urlStr.includes("/v2/checkout/orders")) {
        return new Response(
          JSON.stringify({
            id: "ord_reuse_test",
            status: "CREATED",
            links: [
              {
                rel: "approve",
                href: "https://sandbox.paypal.com/checkoutnow?token=ord_reuse_test",
                method: "GET",
              },
            ],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new SandboxPayPalAdapter({
      clientId: "test_client",
      clientSecret: "test_secret",
      fetchFn: fakeFetch,
    });

    const p = makeProposal();
    await adapter.createOrder(p);
    await adapter.createOrder(p);
    expect(tokenRequests).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 2100));

    await adapter.createOrder(p);
    expect(tokenRequests).toBe(2);
  });

  it("createOrder sends intent AUTHORIZE, item amounts that sum exactly to the total (including 0.1 + 0.2 and 49.99 * 3), URLs, and PayPal-Request-Id", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    let capturedHeaders: Record<string, string> | null = null;

    const fakeFetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("/v1/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "mock_token",
              expires_in: 3600,
            }),
            { status: 200 },
          );
        }
        if (urlStr.includes("/v2/checkout/orders")) {
          capturedBody = JSON.parse(init?.body as string);
          capturedHeaders = init?.headers as Record<string, string>;
          return new Response(
            JSON.stringify({
              id: "ord_round_test",
              status: "CREATED",
              links: [
                {
                  rel: "approve",
                  href: "https://sandbox.paypal.com/approve?token=ord_round_test",
                  method: "GET",
                },
              ],
            }),
            { status: 201 },
          );
        }
        return new Response("{}", { status: 200 });
      },
    ) as unknown as typeof fetch;

    const adapter = new SandboxPayPalAdapter({
      clientId: "test_client",
      clientSecret: "test_secret",
      publicBaseUrl: "http://localhost:5173",
      fetchFn: fakeFetch,
    });

    const p1 = makeProposal(
      { id: "prop_round_1", total: 0.3 },
      [
        { unitPrice: 0.1, quantity: 1 },
        { unitPrice: 0.2, quantity: 1 },
      ],
    );

    await adapter.createOrder(p1);

    expect(capturedBody).not.toBeNull();
    const bodyObj = capturedBody as unknown as {
      intent: string;
      purchase_units: Array<{
        amount: {
          value: string;
          breakdown: { item_total: { value: string } };
        };
      }>;
      payment_source: {
        paypal: {
          experience_context: {
            return_url: string;
            cancel_url: string;
            shipping_preference: string;
          };
        };
      };
    };
    const pu1 = bodyObj.purchase_units[0];

    expect(bodyObj.intent).toBe("AUTHORIZE");
    expect(pu1.amount.value).toBe("0.30");
    expect(pu1.amount.breakdown.item_total.value).toBe("0.30");
    expect(capturedHeaders?.["PayPal-Request-Id"]).toBe("create_prop_round_1");
    expect(
      bodyObj.payment_source.paypal.experience_context.return_url,
    ).toBe("http://localhost:5173/api/paypal/return?proposalId=prop_round_1");

    const p2 = makeProposal(
      { id: "prop_round_2", total: 149.97 },
      [{ unitPrice: 49.99, quantity: 3 }],
    );

    await adapter.createOrder(p2);
    const pu2 = (
      capturedBody as unknown as {
        purchase_units: Array<{
          amount: {
            value: string;
            breakdown: { item_total: { value: string } };
          };
        }>;
      }
    ).purchase_units[0];

    expect(pu2.amount.value).toBe("149.97");
    expect(pu2.amount.breakdown.item_total.value).toBe("149.97");
    expect(capturedHeaders?.["PayPal-Request-Id"]).toBe("create_prop_round_2");
  });

  it("response without an approve link throws", async () => {
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v1/oauth2/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock_token", expires_in: 3600 }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          id: "ord_no_approve",
          status: "CREATED",
          links: [
            {
              rel: "self",
              href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/ord_no_approve",
              method: "GET",
            },
          ],
        }),
        { status: 201 },
      );
    }) as unknown as typeof fetch;

    const adapter = new SandboxPayPalAdapter({
      clientId: "test_client",
      clientSecret: "test_secret",
      fetchFn: fakeFetch,
    });

    await expect(adapter.createOrder(makeProposal())).rejects.toThrow(
      /missing approve link/,
    );
  });

  it("authorizeOrder returns the amount from the response, not the proposal", async () => {
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v1/oauth2/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock_token", expires_in: 3600 }),
          { status: 200 },
        );
      }
      if (urlStr.includes("/authorize")) {
        return new Response(
          JSON.stringify({
            id: "ord_resp_amt",
            status: "COMPLETED",
            purchase_units: [
              {
                payments: {
                  authorizations: [
                    {
                      id: "auth_resp_42",
                      status: "CREATED",
                      amount: {
                        value: "42.50",
                        currency_code: "USD",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 201 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new SandboxPayPalAdapter({
      clientId: "test_client",
      clientSecret: "test_secret",
      fetchFn: fakeFetch,
    });

    const res = await adapter.authorizeOrder("ord_resp_amt");
    expect(res.authorizationId).toBe("auth_resp_42");
    expect(res.amount).toBe(42.5);
    expect(res.currency).toBe("USD");
  });

  it("a non-2xx response throws with PayPal's error name and debug id and message contains no secret or token", async () => {
    const secret = "super_confidential_secret_xyz123";
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v1/oauth2/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock_token_abc987", expires_in: 3600 }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          name: "INVALID_REQUEST",
          message: "Request is not well-formed, syntactically incorrect, or violates schema.",
          debug_id: "dbg_err_abc123",
          details: [
            {
              field: "/purchase_units/@reference_id=='default'/amount/value",
              value: "invalid",
              location: "body",
              issue: "CANNOT_BE_NEGATIVE",
              description: "Must be greater than or equal to 0.",
            },
          ],
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "paypal-debug-id": "dbg_err_abc123",
          },
        },
      );
    }) as unknown as typeof fetch;

    const adapter = new SandboxPayPalAdapter({
      clientId: "test_client",
      clientSecret: secret,
      fetchFn: fakeFetch,
    });

    let caughtError: unknown = null;
    try {
      await adapter.createOrder(makeProposal());
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(PayPalApiError);
    const apiErr = caughtError as PayPalApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.paypalName).toBe("INVALID_REQUEST");
    expect(apiErr.debugId).toBe("dbg_err_abc123");
    expect(apiErr.message).not.toContain(secret);
    expect(apiErr.message).not.toContain("mock_token_abc987");
    expect(apiErr.message).toContain("dbg_err_abc123");
    expect(apiErr.message).toContain("INVALID_REQUEST");
  });

  it("a timeout throws a clear error", async () => {
    const fakeFetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortErr = new Error("This operation was aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        });
      },
    ) as unknown as typeof fetch;

    const adapter = new SandboxPayPalAdapter({
      clientId: "test_client",
      clientSecret: "test_secret",
      timeoutMs: 50,
      fetchFn: fakeFetch,
    });

    await expect(adapter.createOrder(makeProposal())).rejects.toThrow(
      /PayPal request timed out after 50ms/,
    );
  });

  it("the same logical action reuses the same request id on retry", async () => {
    const requestIds: string[] = [];

    const fakeFetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        const headers = init?.headers as Record<string, string>;
        if (headers?.["PayPal-Request-Id"]) {
          requestIds.push(headers["PayPal-Request-Id"]);
        }
        if (urlStr.includes("/v1/oauth2/token")) {
          return new Response(
            JSON.stringify({ access_token: "mock_token", expires_in: 3600 }),
            { status: 200 },
          );
        }
        if (urlStr.includes("/v2/checkout/orders/ord_retry/authorize")) {
          return new Response(
            JSON.stringify({
              id: "ord_retry",
              status: "COMPLETED",
              purchase_units: [
                {
                  payments: {
                    authorizations: [
                      {
                        id: "auth_retry",
                        status: "CREATED",
                        amount: { value: "10.00", currency_code: "USD" },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 201 },
          );
        }
        if (urlStr.includes("/v2/payments/authorizations/auth_retry/capture")) {
          return new Response(
            JSON.stringify({ id: "cap_retry", status: "COMPLETED" }),
            { status: 201 },
          );
        }
        if (urlStr.includes("/v2/payments/authorizations/auth_retry/void")) {
          return new Response(null, { status: 204 });
        }
        return new Response(
          JSON.stringify({
            id: "ord_retry",
            status: "CREATED",
            links: [
              {
                rel: "approve",
                href: "https://sandbox.paypal.com/approve?token=ord_retry",
                method: "GET",
              },
            ],
          }),
          { status: 201 },
        );
      },
    ) as unknown as typeof fetch;

    const adapter = new SandboxPayPalAdapter({
      clientId: "test_client",
      clientSecret: "test_secret",
      fetchFn: fakeFetch,
    });

    const p = makeProposal({ id: "prop_idempotent_1" });
    await adapter.createOrder(p);
    await adapter.createOrder(p);
    expect(requestIds.filter((id) => id === "create_prop_idempotent_1")).toHaveLength(2);

    await adapter.authorizeOrder("ord_retry");
    await adapter.authorizeOrder("ord_retry");
    expect(requestIds.filter((id) => id === "auth_ord_retry")).toHaveLength(2);

    await adapter.captureAuthorization("auth_retry");
    await adapter.captureAuthorization("auth_retry");
    expect(requestIds.filter((id) => id === "capture_auth_retry")).toHaveLength(2);

    await adapter.voidAuthorization("auth_retry");
    await adapter.voidAuthorization("auth_retry");
    expect(requestIds.filter((id) => id === "void_auth_retry")).toHaveLength(2);
  });

  it("capture throws when the status is not completed", async () => {
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v1/oauth2/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock_token", expires_in: 3600 }),
          { status: 200 },
        );
      }
      if (urlStr.includes("/capture")) {
        return new Response(
          JSON.stringify({
            id: "cap_pending",
            status: "PENDING",
          }),
          { status: 201 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new SandboxPayPalAdapter({
      clientId: "test_client",
      clientSecret: "test_secret",
      fetchFn: fakeFetch,
    });

    await expect(
      adapter.captureAuthorization("auth_pending_test"),
    ).rejects.toThrow(/status is PENDING, expected COMPLETED/);
  });

  it("app refuses to start with clear message when PAYPAL_MODE is sandbox and credentials are missing", () => {
    const origMode = process.env.PAYPAL_MODE;
    const origId = process.env.PAYPAL_CLIENT_ID;
    const origSecret = process.env.PAYPAL_CLIENT_SECRET;

    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;

    const db = createDb(":memory:");
    try {
      expect(() => {
        createApp(db, {
          signingSecret: "test_secret_12345678901234567890",
          paypalMode: "sandbox",
        });
      }).toThrow(
        "PayPal sandbox mode requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables",
      );
    } finally {
      db.close();
      if (origMode) process.env.PAYPAL_MODE = origMode;
      if (origId) process.env.PAYPAL_CLIENT_ID = origId;
      if (origSecret) process.env.PAYPAL_CLIENT_SECRET = origSecret;
    }
  });

  it("app starts normally and nothing changes when PAYPAL_MODE is mock", () => {
    const db = createDb(":memory:");
    try {
      const app = createApp(db, {
        signingSecret: "test_secret_12345678901234567890",
        paypalMode: "mock",
      });
      expect(app).toBeDefined();

      const adapter = createPayPalAdapter("mock", { db });
      expect(adapter).toBeInstanceOf(MockPayPalAdapter);
    } finally {
      db.close();
    }
  });

  it("422 response with an INSTRUMENT_DECLINED issue produces an error carrying the issue name and debug id and no secret", async () => {
    const secret = "confidential_test_secret_999";
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v1/oauth2/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock_token", expires_in: 3600 }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          name: "UNPROCESSABLE_ENTITY",
          message: "The requested action could not be performed, semantically incorrect, or failed business validation.",
          debug_id: "dbg_declined_888",
          details: [
            {
              issue: "INSTRUMENT_DECLINED",
              description: "The instrument presented was either declined by the processor or bank, or it can't be used for this payment.",
            },
          ],
        }),
        {
          status: 422,
          headers: {
            "Content-Type": "application/json",
            "paypal-debug-id": "dbg_declined_888",
          },
        },
      );
    }) as unknown as typeof fetch;

    const adapter = new SandboxPayPalAdapter({
      clientId: "test_client",
      clientSecret: secret,
      fetchFn: fakeFetch,
    });

    let caughtError: unknown = null;
    try {
      await adapter.authorizeOrder("ord_declined_test");
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(PayPalApiError);
    const apiErr = caughtError as PayPalApiError;
    expect(apiErr.status).toBe(422);
    expect(apiErr.paypalName).toBe("UNPROCESSABLE_ENTITY");
    expect(apiErr.issue).toBe("INSTRUMENT_DECLINED");
    expect(apiErr.debugId).toBe("dbg_declined_888");
    expect(apiErr.message).toContain("INSTRUMENT_DECLINED");
    expect(apiErr.message).toContain("dbg_declined_888");
    expect(apiErr.message).not.toContain(secret);
  });

  it("server normal code path never sends the mock response header", async () => {
    let capturedHeaders: Record<string, string> | null = null;
    const fakeFetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        capturedHeaders = init?.headers as Record<string, string>;
        if (urlStr.includes("/v1/oauth2/token")) {
          return new Response(
            JSON.stringify({ access_token: "mock_token", expires_in: 3600 }),
            { status: 200 },
          );
        }
        if (urlStr.includes("/v2/checkout/orders")) {
          return new Response(
            JSON.stringify({
              id: "ord_normal",
              status: "CREATED",
              links: [
                {
                  rel: "approve",
                  href: "https://sandbox.paypal.com/approve?token=ord_normal",
                  method: "GET",
                },
              ],
            }),
            { status: 201 },
          );
        }
        return new Response("{}", { status: 200 });
      },
    ) as unknown as typeof fetch;

    const adapter = new SandboxPayPalAdapter({
      clientId: "test_client",
      clientSecret: "test_secret",
      fetchFn: fakeFetch,
    });

    await adapter.createOrder(makeProposal());
    expect(capturedHeaders?.["PayPal-Mock-Response"]).toBeUndefined();
  });

  it("payment info mode for sandbox orders is sandbox", async () => {
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v1/oauth2/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock_token", expires_in: 3600 }),
          { status: 200 },
        );
      }
      if (urlStr.includes("/v2/checkout/orders")) {
        return new Response(
          JSON.stringify({
            id: "ord_sandbox_mode_test",
            status: "CREATED",
            links: [
              {
                rel: "approve",
                href: "https://sandbox.paypal.com/approve?token=ord_sandbox_mode_test",
                method: "GET",
              },
            ],
          }),
          { status: 201 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const db = createDb(":memory:");
    try {
      const sandboxAdapter = new SandboxPayPalAdapter({
        clientId: "test_client",
        clientSecret: "test_secret",
        fetchFn: fakeFetch,
        db,
      });

      const signingSecret = "test_signing_secret_12345678901234";

      createApp(db, {
        signingSecret,
        paypalMode: "sandbox",
        paypalAdapter: sandboxAdapter,
      });

      const shippingAddress = {
        name: "Rohan Verma",
        line1: "100 Feet Road, Indiranagar",
        city: "Bengaluru",
        region: "Karnataka",
        postalCode: "560038",
        country: "India",
      };

      const mandateInput = {
        id: "mand_sandbox_test",
        owner: "User",
        currency: "USD" as const,
        totalBudget: 100,
        perItemCap: 100,
        approvalThreshold: 100,
        allowedCategories: ["hiking"],
        allowedMerchants: ["Trailhead Supply"],
        maxQuantityPerItem: 5,
        shippingAddress,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      };
      const signature = signMandate(mandateInput, signingSecret);
      saveMandate(db, { ...mandateInput, signature });

      const prop = await submitProposal({
        items: [
          {
            productId: "prod_1",
            title: "Hiking Poles",
            merchant: "Trailhead Supply",
            category: "hiking",
            unitPrice: 25.0,
            quantity: 1,
            url: "https://example.com/poles",
          },
        ],
        shipTo: shippingAddress,
        currency: "USD",
        agentReasoning: "Testing sandbox payment mode",
        sourceUrls: ["https://example.com/poles"],
      });

      expect(prop.status).toBe("awaiting_buyer");
      expect(prop.payment?.mode).toBe("sandbox");
      expect(prop.payment?.orderId).toBe("ord_sandbox_mode_test");
    } finally {
      db.close();
    }
  });

  it("an order created through the mock adapter stores mode mock", async () => {
    const db = createDb(":memory:");
    try {
      const mockAdapter = new MockPayPalAdapter(db);
      const signingSecret = "test_signing_secret_mock_mode_123";

      createApp(db, {
        signingSecret,
        paypalMode: "mock",
        paypalAdapter: mockAdapter,
      });

      const shippingAddress = {
        name: "Rohan Verma",
        line1: "100 Feet Road, Indiranagar",
        city: "Bengaluru",
        region: "Karnataka",
        postalCode: "560038",
        country: "India",
      };

      const mandateInput = {
        id: "mand_mock_mode_test",
        owner: "User",
        currency: "USD" as const,
        totalBudget: 100,
        perItemCap: 100,
        approvalThreshold: 100,
        allowedCategories: ["hiking"],
        allowedMerchants: ["Trailhead Supply"],
        maxQuantityPerItem: 5,
        shippingAddress,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      };
      const signature = signMandate(mandateInput, signingSecret);
      saveMandate(db, { ...mandateInput, signature });

      const prop = await submitProposal({
        items: [
          {
            productId: "prod_mock_1",
            title: "Daypack",
            merchant: "Trailhead Supply",
            category: "hiking",
            unitPrice: 20.0,
            quantity: 1,
            url: "https://example.com/daypack",
          },
        ],
        shipTo: shippingAddress,
        currency: "USD",
        agentReasoning: "Testing mock payment mode",
        sourceUrls: ["https://example.com/daypack"],
      });

      expect(prop.status).toBe("awaiting_buyer");
      expect(prop.payment?.mode).toBe("mock");
    } finally {
      db.close();
    }
  });

  it("the database has no triggers after the app starts", () => {
    const db = createDb(":memory:");
    try {
      createApp(db, {
        signingSecret: "test_signing_secret_triggers_123",
        paypalMode: "mock",
      });

      const triggers = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all() as Array<{ name: string }>;

      expect(triggers).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("a database that still contains the old trigger has it removed on startup", () => {
    const db = createDb(":memory:");
    try {
      db.exec(`
        CREATE TRIGGER set_sandbox_payment_mode
        AFTER UPDATE ON proposals
        BEGIN
          SELECT 1;
        END;
      `);

      const beforeTriggers = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all() as Array<{ name: string }>;
      expect(beforeTriggers.map((t) => t.name)).toContain(
        "set_sandbox_payment_mode",
      );

      createApp(db, {
        signingSecret: "test_signing_secret_drop_trigger_123",
        paypalMode: "sandbox",
        paypalAdapter: new SandboxPayPalAdapter({
          clientId: "id",
          clientSecret: "secret",
        }),
      });

      const afterTriggers = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all() as Array<{ name: string }>;
      expect(afterTriggers).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
