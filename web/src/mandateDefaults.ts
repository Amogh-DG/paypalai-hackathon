import type { MandateInput } from "@leash/shared";

export const CATEGORY_OPTIONS = ["hiking", "books", "kitchen", "electronics"];

export function createEmptyMandate(): MandateInput {
  return {
    owner: "",
    currency: "USD",
    totalBudget: Number.NaN,
    perItemCap: Number.NaN,
    approvalThreshold: Number.NaN,
    maxQuantityPerItem: Number.NaN,
    allowedCategories: [],
    allowedMerchants: [],
    shippingAddress: {
      name: "",
      line1: "",
      city: "",
      region: "",
      postalCode: "",
      country: "",
    },
    expiresAt: "",
  };
}

export function createMandateDefaults(): MandateInput {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  return {
    owner: "Demo User",
    currency: "USD",
    totalBudget: 80,
    perItemCap: 60,
    approvalThreshold: 50,
    maxQuantityPerItem: 2,
    allowedCategories: ["hiking", "books", "kitchen", "electronics"],
    allowedMerchants: ["Trailhead Supply", "Page Turner Books"],
    shippingAddress: {
      name: "Demo Buyer",
      line1: "12 Example Street",
      city: "Springfield",
      region: "IL",
      postalCode: "62701",
      country: "US",
    },
    expiresAt: expiresAt.toISOString(),
  };
}
