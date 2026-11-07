import { describe, it, expect } from "vitest";
import { dollarsToCents, centsToDollars } from "@leash/shared";

describe("money helpers", () => {
  it("converts 19.99 to integer cents and back to dollars", () => {
    const cents = dollarsToCents(19.99);
    expect(cents).toBe(1999);
    expect(centsToDollars(cents)).toBe(19.99);
  });

  it("converts 0.1 plus 0.2 to integer cents and back to dollars", () => {
    const amount = 0.1 + 0.2;
    const cents = dollarsToCents(amount);
    expect(cents).toBe(30);
    expect(centsToDollars(cents)).toBe(0.3);
  });

  it("converts 49.99 times 3 to integer cents and back to dollars", () => {
    const amount = 49.99 * 3;
    const cents = dollarsToCents(amount);
    expect(cents).toBe(14997);
    expect(centsToDollars(cents)).toBe(149.97);
  });
});
