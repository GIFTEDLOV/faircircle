import { describe, expect, it } from "vitest";
import { getAddress, maxUint256 } from "viem";
import {
  deadlineInputToUnixSeconds,
  validateCapacity,
  validateMembers,
  validateOptions,
  validateTitle,
} from "./validation";

const addressA = "0x00000000000000000000000000000000000000aA";
const addressB = "0x00000000000000000000000000000000000000Bb";

describe("QuietBudget validation", () => {
  it("requires a trimmed non-empty title", () => {
    expect(validateTitle("   ")).toHaveLength(1);
    expect(validateTitle("  Weekend trip  ")).toHaveLength(0);
  });

  it("normalizes valid unique member addresses", () => {
    const result = validateMembers([addressA, addressB]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.members).toEqual([getAddress(addressA), getAddress(addressB)]);
    }
  });

  it("rejects duplicate normalized member addresses", () => {
    const result = validateMembers([addressA.toLowerCase(), getAddress(addressA)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.message)).toContain(
        "Member addresses must be unique.",
      );
    }
  });

  it("rejects zero and invalid member addresses", () => {
    const result = validateMembers([
      "0x0000000000000000000000000000000000000000",
      "not-an-address",
    ]);
    expect(result.ok).toBe(false);
  });

  it("accepts unique positive whole-number option costs", () => {
    const result = validateOptions(["10", "25", "40"], 100n);
    expect(result).toEqual({ ok: true, values: [10n, 25n, 40n] });
  });

  it("rejects duplicate option costs", () => {
    const result = validateOptions(["10", "010"], 100n);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.message)).toContain(
        "Option costs must be unique.",
      );
    }
  });

  it("rejects non-whole, zero, uint256 overflow, and above-maximum option costs", () => {
    expect(validateOptions(["1.5"], 100n).ok).toBe(false);
    expect(validateOptions(["0"], 100n).ok).toBe(false);
    expect(validateOptions([(maxUint256 + 1n).toString()], maxUint256).ok).toBe(false);
    expect(validateOptions(["101"], 100n).ok).toBe(false);
  });

  it("validates nonnegative capacity with uint256 and app maximum checks", () => {
    expect(validateCapacity("0", 100n)).toEqual({ ok: true, value: 0n });
    expect(validateCapacity("-1", 100n).ok).toBe(false);
    expect(validateCapacity((maxUint256 + 1n).toString(), maxUint256).ok).toBe(false);
    expect(validateCapacity("101", 100n).ok).toBe(false);
  });

  it("converts future deadline input to unix seconds", () => {
    expect(deadlineInputToUnixSeconds("2026-07-30T13:05", Date.parse("2026-07-30T12:00"))).toEqual({
      ok: true,
      value: BigInt(Math.floor(Date.parse("2026-07-30T13:05") / 1000)),
    });
    expect(deadlineInputToUnixSeconds("2026-07-30T11:00", Date.parse("2026-07-30T12:00")).ok)
      .toBe(false);
  });
});
