import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { getServerSepoliaRpcUrl } from "@/lib/web3/server-public-client";

vi.mock("server-only", () => ({}));

describe("QuietBudget room-history API", () => {
  afterEach(() => {
    delete process.env.SEPOLIA_RPC_URL;
    delete process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;
  });

  it("rejects malformed account queries", async () => {
    const response = await GET(request("http://localhost/api/quiet-budget/rooms?account=nope"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "INVALID_ACCOUNT",
        message: "Use a valid wallet address.",
      },
    });
  });

  it("returns a sanitized configuration error when server RPC is missing", async () => {
    const response = await GET(request(
      "http://localhost/api/quiet-budget/rooms?account=0x00000000000000000000000000000000000000aa",
    ));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: {
        code: "MISSING_RPC",
        message: "Room history is not configured on this server.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("SEPOLIA_RPC_URL");
  });

  it("does not use NEXT_PUBLIC RPC configuration for server history", () => {
    process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL = "https://public.example/rpc";
    expect(() => getServerSepoliaRpcUrl()).toThrow("Room history is not configured on this server.");
  });
});

function request(url: string) {
  return new NextRequest(url, {
    headers: {
      "x-forwarded-for": `test-${Math.random()}`,
    },
  });
}
