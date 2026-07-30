"use client";

import type { HandleClient } from "@iexec-nox/handle";
import type { Address, WalletClient } from "viem";
import { SEPOLIA_CHAIN_ID } from "@/lib/web3/clients";
import { WalletNotFoundError, WrongNetworkError } from "@/lib/web3/errors";
import { getNoxBrowserConfig } from "./config";

export async function createBrowserNoxHandleClient({
  walletClient,
  account,
  chainId,
}: {
  walletClient?: WalletClient;
  account?: Address;
  chainId?: number;
}): Promise<HandleClient> {
  if (typeof window === "undefined") {
    throw new WalletNotFoundError();
  }
  if (walletClient === undefined || account === undefined) {
    throw new WalletNotFoundError();
  }
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new WrongNetworkError(chainId);
  }
  const { createViemHandleClient } = await import("@iexec-nox/handle");
  return createViemHandleClient(scopedWallet(walletClient, account), getNoxBrowserConfig());
}

function scopedWallet(walletClient: WalletClient, account: Address) {
  return new Proxy(walletClient, {
    get(target, property, receiver) {
      if (property === "account") {
        return { address: account };
      }
      if (property === "getAddresses") {
        return async () => [account];
      }
      return Reflect.get(target, property, receiver);
    },
  }) as WalletClient;
}
