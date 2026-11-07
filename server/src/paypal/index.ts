import type { PayPalAdapter } from "./adapter.js";
import { MockPayPalAdapter } from "./mock.js";

export * from "./adapter.js";
export * from "./mock.js";

export function createPayPalAdapter(
  mode: string = process.env.PAYPAL_MODE || "mock",
  options?: {
    publicBaseUrl?: string;
    authorizeAmountOverride?: number;
  },
): PayPalAdapter {
  if (mode === "mock") {
    return new MockPayPalAdapter(options);
  }
  if (mode === "sandbox") {
    throw new Error("PayPal sandbox mode is not implemented yet");
  }
  throw new Error(`Unknown PayPal mode: ${mode}`);
}
