import { describe, it, expect } from "vitest";

describe("normalize helper", () => {
  it("normalizes leading and trailing spaces, mixed case, and double spaces inside a string to the same result", async () => {
    const mod = await import("../../shared/normalize.js" as string);
    const normalize = mod.normalize as (val: string) => string;

    const canonical = "acme corporation";
    const withLeadingTrailing = "   acme corporation   ";
    const withMixedCase = "Acme Corporation";
    const withDoubleSpaces = "acme  corporation";
    const combined = "  AcMe   CoRpoRation  ";

    expect(normalize(canonical)).toBe(canonical);
    expect(normalize(withLeadingTrailing)).toBe(canonical);
    expect(normalize(withMixedCase)).toBe(canonical);
    expect(normalize(withDoubleSpaces)).toBe(canonical);
    expect(normalize(combined)).toBe(canonical);
  });
});
