import type { Database as DatabaseType } from "better-sqlite3";
import type { PayPalAdapter } from "./adapter.js";
import { MockPayPalAdapter, type MockPayPalOptions } from "./mock.js";
import {
  SandboxPayPalAdapter,
  type SandboxPayPalOptions,
} from "./sandbox.js";

export * from "./adapter.js";
export * from "./mock.js";
export * from "./sandbox.js";

export function createPayPalAdapter(
  mode: string = process.env.PAYPAL_MODE || "mock",
  options?: (MockPayPalOptions | SandboxPayPalOptions) & { db?: DatabaseType },
): PayPalAdapter {
  if (mode === "mock") {
    return new MockPayPalAdapter(options?.db, options as MockPayPalOptions);
  }
  if (mode === "sandbox") {
    const clientId =
      (options as SandboxPayPalOptions)?.clientId ||
      process.env.PAYPAL_CLIENT_ID;
    const clientSecret =
      (options as SandboxPayPalOptions)?.clientSecret ||
      process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "PayPal sandbox mode requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables (PayPal sandbox mode is not implemented yet without them)",
      );
    }
    return new SandboxPayPalAdapter({
      clientId,
      clientSecret,
      publicBaseUrl: options?.publicBaseUrl,
      db: options?.db,
      ...(options as SandboxPayPalOptions),
    });
  }
  throw new Error(`Unknown PayPal mode: ${mode}`);
}
