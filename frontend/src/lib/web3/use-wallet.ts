"use client";

import { useContext } from "react";
import { WalletContext } from "./wallet-provider";

export function useWallet() {
  const value = useContext(WalletContext);
  if (value === undefined) {
    throw new Error("useWallet must be used within WalletProvider.");
  }
  return value;
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
