import crypto from "node:crypto";

export function newId(prefix: "mand_" | "prop_" | "aud_" | string): string {
  const p = prefix.endsWith("_") ? prefix : `${prefix}_`;
  const random = crypto.randomBytes(12).toString("hex");
  return `${p}${random}`;
}
