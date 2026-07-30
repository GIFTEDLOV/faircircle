"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
} from "viem";
import { sepolia } from "viem/chains";

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_CHAIN_HEX = "0xaa36a7";
export const PUBLIC_SEPOLIA_RPC_FALLBACK = "https://ethereum-sepolia-rpc.publicnode.com";

export type FairCircleEthereumProvider = EIP1193Provider & {
  on?: (event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void) => void;
};

export function getPublicSepoliaRpcUrl() {
  return process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL?.trim() || PUBLIC_SEPOLIA_RPC_FALLBACK;
}

export function createFairCirclePublicClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(getPublicSepoliaRpcUrl()),
  });
}

export function createFairCircleWalletClient(
  provider: FairCircleEthereumProvider,
  account: Address,
) {
  return createWalletClient({
    account,
    chain: sepolia,
    transport: custom(provider),
  });
}

export function injectedProvider() {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.ethereum as FairCircleEthereumProvider | undefined;
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
