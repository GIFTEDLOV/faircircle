import "server-only";

import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

export class MissingServerRpcError extends Error {
  constructor() {
    super("Room history is not configured on this server.");
    this.name = "MissingServerRpcError";
  }
}

export function getServerSepoliaRpcUrl() {
  const value = process.env.SEPOLIA_RPC_URL?.trim();
  if (!value) {
    throw new MissingServerRpcError();
  }
  return value;
}

export function createServerSepoliaPublicClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(getServerSepoliaRpcUrl()),
  });
}
