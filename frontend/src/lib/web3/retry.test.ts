import { describe, expect, it, vi } from "vitest";
import { isTransientRpcError, withTransientRpcRetry } from "./retry";

describe("transient RPC retry", () => {
  it("retries rate limits and resolves when the provider recovers", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate limit"), { code: 429 }))
      .mockResolvedValue("ok");

    await expect(withTransientRpcRetry(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry contract or validation failures", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("execution reverted: NotMember"));

    await expect(withTransientRpcRetry(operation)).rejects.toThrow("NotMember");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("recognizes provider timeout and server errors", () => {
    expect(isTransientRpcError(new Error("request timed out"))).toBe(true);
    expect(isTransientRpcError({ status: 503, message: "unavailable" })).toBe(true);
    expect(isTransientRpcError(new Error("execution reverted"))).toBe(false);
  });
});
