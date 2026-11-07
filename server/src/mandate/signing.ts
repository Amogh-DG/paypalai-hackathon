import crypto from "node:crypto";
import type { Mandate } from "@leash/shared";

export function serializeMandate(mandate: Omit<Mandate, "signature">): string {
  return JSON.stringify({
    id: mandate.id,
    owner: mandate.owner,
    currency: mandate.currency,
    totalBudget: mandate.totalBudget,
    perItemCap: mandate.perItemCap,
    approvalThreshold: mandate.approvalThreshold,
    allowedCategories: mandate.allowedCategories,
    allowedMerchants: mandate.allowedMerchants,
    maxQuantityPerItem: mandate.maxQuantityPerItem,
    shippingAddress: {
      name: mandate.shippingAddress.name,
      line1: mandate.shippingAddress.line1,
      city: mandate.shippingAddress.city,
      region: mandate.shippingAddress.region,
      postalCode: mandate.shippingAddress.postalCode,
      country: mandate.shippingAddress.country,
    },
    expiresAt: mandate.expiresAt,
    createdAt: mandate.createdAt,
  });
}

export function signMandate(
  mandate: Omit<Mandate, "signature">,
  secret: string,
): string {
  const payload = serializeMandate(mandate);
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyMandate(mandate: Mandate, secret: string): boolean {
  if (
    typeof mandate.signature !== "string" ||
    mandate.signature.length !== 64 ||
    !/^[0-9a-f]{64}$/i.test(mandate.signature)
  ) {
    return false;
  }

  const expectedSignature = signMandate(mandate, secret);
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(mandate.signature, "hex");

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch {
    return false;
  }
}

export function verifyMandateSignature(
  mandate: Mandate,
  secret: string,
): boolean {
  return verifyMandate(mandate, secret);
}
