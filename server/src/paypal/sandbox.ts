import type { Database as DatabaseType } from "better-sqlite3";
import {
  type Proposal,
  centsToDollars,
  dollarsToCents,
} from "@leash/shared";
import type { PayPalAdapter } from "./adapter.js";

export class PayPalApiError extends Error {
  readonly status: number;
  readonly paypalName?: string;
  readonly debugId?: string;
  readonly details?: unknown;
  readonly issue?: string;

  constructor(params: {
    status: number;
    message: string;
    paypalName?: string;
    debugId?: string;
    details?: unknown;
    issue?: string;
  }) {
    super(params.message);
    this.name = "PayPalApiError";
    this.status = params.status;
    this.paypalName = params.paypalName;
    this.debugId = params.debugId;
    this.details = params.details;
    this.issue = params.issue;
    Object.setPrototypeOf(this, PayPalApiError.prototype);
  }
}

type PayPalErrorBody = {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: Array<{ issue?: string; description?: string }>;
};

export type SandboxPayPalOptions = {
  clientId?: string;
  clientSecret?: string;
  publicBaseUrl?: string;
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
  db?: DatabaseType;
};

function toCountryCode(country: string): string {
  const trimmed = country.trim();
  if (trimmed.length === 2) {
    return trimmed.toUpperCase();
  }
  const lower = trimmed.toLowerCase();
  if (lower === "india") {
    return "IN";
  }
  if (
    lower === "united states" ||
    lower === "united states of america" ||
    lower === "usa" ||
    lower === "us"
  ) {
    return "US";
  }
  return "US";
}

export class SandboxPayPalAdapter implements PayPalAdapter {
  readonly mode: "sandbox" = "sandbox";
  private clientId: string;
  private clientSecret: string;
  private publicBaseUrl: string;
  private apiBaseUrl: string;
  private fetchFn: typeof fetch;
  private extraHeaders?: Record<string, string>;
  private timeoutMs: number;
  private db?: DatabaseType;
  private inFlightTokenPromise: Promise<string> | null = null;
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;
  private lastDebugId?: string;

  constructor(options?: SandboxPayPalOptions) {
    this.clientId =
      options?.clientId || process.env.PAYPAL_CLIENT_ID || "";
    this.clientSecret =
      options?.clientSecret || process.env.PAYPAL_CLIENT_SECRET || "";
    this.publicBaseUrl =
      options?.publicBaseUrl ||
      process.env.PUBLIC_BASE_URL ||
      "http://localhost:5173";
    this.apiBaseUrl =
      options?.apiBaseUrl || "https://api-m.sandbox.paypal.com";
    this.fetchFn = options?.fetchFn || globalThis.fetch;
    this.extraHeaders = options?.extraHeaders;
    this.timeoutMs = options?.timeoutMs ?? 15000;
    this.db = options?.db;
  }

  setDb(db: DatabaseType): void {
    this.db = db;
  }

  setExtraHeaders(headers?: Record<string, string>): void {
    this.extraHeaders = headers;
  }

  hasDb(): boolean {
    return Boolean(this.db);
  }

  getLastDebugId(): string | undefined {
    return this.lastDebugId;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.accessToken;
    }
    if (this.inFlightTokenPromise) {
      return this.inFlightTokenPromise;
    }
    this.inFlightTokenPromise = this.requestNewToken().finally(() => {
      this.inFlightTokenPromise = null;
    });
    return this.inFlightTokenPromise;
  }

  private async requestNewToken(): Promise<string> {
    const creds = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");
    const headers: Record<string, string> = {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    const body = "grant_type=client_credentials";

    const res = await this.doRequest(
      `${this.apiBaseUrl}/v1/oauth2/token`,
      {
        method: "POST",
        headers,
        body,
      },
    );

    const data = (await res.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };

    if (!data.access_token) {
      throw new Error("PayPal OAuth response missing access_token");
    }

    const bufferMs = 60 * 1000;
    const expiresInMs = (data.expires_in || 3600) * 1000;
    const expiresAt = Date.now() + Math.max(expiresInMs - bufferMs, 1000);

    this.cachedToken = {
      accessToken: data.access_token,
      expiresAt,
    };

    return data.access_token;
  }

  private async doRequest(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url, {
        ...init,
        signal: controller.signal,
      });
      const headerDebugId = res.headers.get("paypal-debug-id") || undefined;
      if (headerDebugId) {
        this.lastDebugId = headerDebugId;
      }
      if (!res.ok) {
        let errData: PayPalErrorBody | null = null;
        try {
          errData = (await res.json()) as PayPalErrorBody;
        } catch {
          errData = null;
        }
        const debugId =
          errData?.debug_id ||
          res.headers.get("paypal-debug-id") ||
          undefined;
        if (debugId) {
          this.lastDebugId = debugId;
        }
        const issue =
          Array.isArray(errData?.details) && errData.details[0]?.issue
            ? String(errData.details[0].issue)
            : undefined;
        const issueDesc =
          Array.isArray(errData?.details) && errData.details[0]?.description
            ? String(errData.details[0].description)
            : undefined;

        const errorParts: string[] = [
          `PayPal API error (status ${res.status}${errData?.name ? ` ${errData.name}` : ""})`,
        ];
        if (issue) {
          errorParts.push(
            `issue: ${issue}${issueDesc ? ` - ${issueDesc}` : ""}`,
          );
        } else if (errData?.message) {
          errorParts.push(String(errData.message));
        }
        if (debugId) {
          errorParts.push(`[debug_id: ${debugId}]`);
        }

        throw new PayPalApiError({
          status: res.status,
          message: errorParts.join(": "),
          paypalName: errData?.name,
          debugId,
          details: errData?.details,
          issue,
        });
      }
      return res;
    } catch (err: unknown) {
      if (err instanceof PayPalApiError) {
        throw err;
      }
      if (
        (err as { name?: string })?.name === "AbortError" ||
        controller.signal.aborted
      ) {
        throw new Error(
          `PayPal request timed out after ${this.timeoutMs}ms`,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`PayPal network request failed: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async createOrder(
    p: Proposal,
  ): Promise<{ orderId: string; approveUrl: string }> {
    const token = await this.getAccessToken();
    const baseUrl = this.publicBaseUrl.replace(/\/+$/, "");
    const returnUrl = `${baseUrl}/api/paypal/return?proposalId=${encodeURIComponent(p.id)}`;
    const cancelUrl = `${baseUrl}/api/paypal/cancel?proposalId=${encodeURIComponent(p.id)}`;

    const items = p.items.map((item) => ({
      name: item.title,
      unit_amount: {
        currency_code: p.currency,
        value: item.unitPrice.toFixed(2),
      },
      quantity: String(item.quantity),
      category: "PHYSICAL_GOODS",
    }));

    const itemTotalCents = p.items.reduce(
      (sum, item) => sum + dollarsToCents(item.unitPrice) * item.quantity,
      0,
    );
    const itemTotalDollars = centsToDollars(itemTotalCents).toFixed(2);
    const totalDollars = p.total.toFixed(2);

    const body = {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          amount: {
            currency_code: p.currency,
            value: totalDollars,
            breakdown: {
              item_total: {
                currency_code: p.currency,
                value: itemTotalDollars,
              },
            },
          },
          items,
          shipping: {
            name: {
              full_name: p.shipTo.name,
            },
            address: {
              address_line_1: p.shipTo.line1,
              admin_area_2: p.shipTo.city,
              admin_area_1: p.shipTo.region,
              postal_code: p.shipTo.postalCode,
              country_code: toCountryCode(p.shipTo.country),
            },
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: returnUrl,
            cancel_url: cancelUrl,
            shipping_preference: "SET_PROVIDED_ADDRESS",
            user_action: "PAY_NOW",
          },
        },
      },
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `create_${p.id}`,
      ...this.extraHeaders,
    };

    const res = await this.doRequest(
      `${this.apiBaseUrl}/v2/checkout/orders`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
    );

    const data = (await res.json()) as {
      id: string;
      status: string;
      links?: Array<{ href: string; rel: string; method: string }>;
    };

    const approveLink = data.links?.find((l) => l.rel === "approve");
    if (!approveLink || !approveLink.href) {
      throw new Error(
        `PayPal create order response missing approve link for order ${data.id}`,
      );
    }

    return {
      orderId: data.id,
      approveUrl: approveLink.href,
    };
  }

  async authorizeOrder(
    orderId: string,
  ): Promise<{ authorizationId: string; amount: number; currency: string }> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `auth_${orderId}`,
      Prefer: "return=representation",
      ...this.extraHeaders,
    };

    const res = await this.doRequest(
      `${this.apiBaseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
      {
        method: "POST",
        headers,
        body: "{}",
      },
    );

    const data = (await res.json()) as {
      id: string;
      status: string;
      purchase_units?: Array<{
        payments?: {
          authorizations?: Array<{
            id: string;
            status: string;
            amount: { value: string; currency_code: string };
          }>;
        };
      }>;
    };

    const auth = data.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth) {
      throw new Error(
        `PayPal order ${orderId} response has no authorization`,
      );
    }

    if (
      auth.status === "DENIED" ||
      auth.status === "VOIDED" ||
      auth.status === "FAILED"
    ) {
      throw new Error(
        `PayPal authorization ${auth.id} status is ${auth.status}`,
      );
    }

    const amount = parseFloat(auth.amount.value);
    const currency = auth.amount.currency_code;

    return {
      authorizationId: auth.id,
      amount,
      currency,
    };
  }

  async captureAuthorization(
    authorizationId: string,
  ): Promise<{ captureId: string }> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `capture_${authorizationId}`,
      Prefer: "return=representation",
      ...this.extraHeaders,
    };

    const res = await this.doRequest(
      `${this.apiBaseUrl}/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ final_capture: true }),
      },
    );

    const data = (await res.json()) as {
      id: string;
      status: string;
    };

    if (data.status !== "COMPLETED") {
      throw new Error(
        `PayPal capture for authorization ${authorizationId} status is ${data.status}, expected COMPLETED`,
      );
    }

    return { captureId: data.id };
  }

  async voidAuthorization(authorizationId: string): Promise<void> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `void_${authorizationId}`,
      ...this.extraHeaders,
    };

    await this.doRequest(
      `${this.apiBaseUrl}/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
      {
        method: "POST",
        headers,
      },
    );
  }

  async verifyWebhookSignature(params: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
    webhookId: string;
    webhookEvent?: Record<string, unknown>;
    rawEvent?: string;
  }): Promise<boolean> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...this.extraHeaders,
    };

    let body: string;
    if (params.rawEvent) {
      const meta = {
        auth_algo: params.authAlgo,
        cert_url: params.certUrl,
        transmission_id: params.transmissionId,
        transmission_sig: params.transmissionSig,
        transmission_time: params.transmissionTime,
        webhook_id: params.webhookId,
      };
      const metaStr = JSON.stringify(meta);
      body = metaStr.slice(0, -1) + `,"webhook_event":${params.rawEvent}}`;
    } else {
      body = JSON.stringify({
        auth_algo: params.authAlgo,
        cert_url: params.certUrl,
        transmission_id: params.transmissionId,
        transmission_sig: params.transmissionSig,
        transmission_time: params.transmissionTime,
        webhook_id: params.webhookId,
        webhook_event: params.webhookEvent,
      });
    }

    try {
      const res = await this.doRequest(
        `${this.apiBaseUrl}/v1/notifications/verify-webhook-signature`,
        {
          method: "POST",
          headers,
          body,
        },
      );
      const data = (await res.json()) as { verification_status?: string };
      return data.verification_status === "SUCCESS";
    } catch {
      return false;
    }
  }
}
