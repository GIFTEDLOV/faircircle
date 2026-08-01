import { describe, expect, it } from "vitest";
import { validateTotalCost } from "./validation";

describe("FairSplit validation", () => {
  it("accepts positive whole-number totals within the contract limit", () => {
    expect(validateTotalCost("100", 1_000n)).toEqual({ ok: true, value: 100n });
  });

  it("rejects zero, fractions, and values above the configured maximum", () => {
    expect(validateTotalCost("0", 1_000n).ok).toBe(false);
    expect(validateTotalCost("1.5", 1_000n).ok).toBe(false);
    expect(validateTotalCost("1001", 1_000n).ok).toBe(false);
  });
});
