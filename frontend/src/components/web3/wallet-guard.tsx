"use client";

import type { ReactNode } from "react";
import { InlineError } from "./inline-error";
import { LoadingState } from "./loading-state";
import { useWallet } from "@/lib/web3/use-wallet";

type WalletGuardProps = {
  children: ReactNode;
};

export function WalletGuard({ children }: WalletGuardProps) {
  const wallet = useWallet();
  if (wallet.status === "hydrating" || wallet.status === "connecting") {
    return <LoadingState label="Checking wallet" />;
  }
  if (wallet.status === "wallet-missing") {
    return <InlineError message="Install or open an injected wallet to continue." />;
  }
  if (!wallet.isConnected) {
    return <InlineError message="Connect a wallet to continue." />;
  }
  return children;
}
