"use client";

import type { ReactNode } from "react";
import { InlineError } from "./inline-error";
import { WalletGuard } from "./wallet-guard";
import { useWallet } from "@/lib/web3/use-wallet";

type NetworkGuardProps = {
  children: ReactNode;
};

export function NetworkGuard({ children }: NetworkGuardProps) {
  const wallet = useWallet();
  if (!wallet.isConnected) {
    return <WalletGuard>{children}</WalletGuard>;
  }
  if (!wallet.isSepolia) {
    return (
      <div className="space-y-3">
        <InlineError message="Switch your wallet to Ethereum Sepolia to continue." />
        <button
          type="button"
          onClick={() => void wallet.switchToSepolia()}
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
        >
          Switch to Sepolia
        </button>
      </div>
    );
  }
  return children;
}
