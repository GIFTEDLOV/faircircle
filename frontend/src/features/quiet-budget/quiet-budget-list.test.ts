import { describe, expect, it } from "vitest";
import { quietBudgetPrivacyCopy } from "./quiet-budget-list";

describe("QuietBudget privacy copy", () => {
  it("uses disconnected wallet copy only while disconnected", () => {
    expect(quietBudgetPrivacyCopy(false)).toContain("wallet connection is required");
  });

  it("uses connected wallet copy after connection", () => {
    expect(quietBudgetPrivacyCopy(true)).toContain("Only QuietBudget rooms involving this connected wallet are shown");
    expect(quietBudgetPrivacyCopy(true)).not.toContain("wallet connection is required");
  });
});
