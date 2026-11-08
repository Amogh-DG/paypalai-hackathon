import type { Database as DatabaseType } from "better-sqlite3";
import type { PayPalAdapter } from "./adapter.js";
import { MockPayPalAdapter, type MockPayPalOptions } from "./mock.js";

export * from "./adapter.js";
export * from "./mock.js";

export function createPayPalAdapter(
  mode: string = process.env.PAYPAL_MODE || "mock",
  options?: MockPayPalOptions & { db?: DatabaseType },
): PayPalAdapter {
  if (mode === "mock") {
    return new MockPayPalAdapter(options?.db, options);
  }
  if (mode === "sandbox") {
    throw new Error("PayPal sandbox mode is not implemented yet");
  }
  throw new Error(`Unknown PayPal mode: ${mode}`);
}
