"use client";

import { useWallet, shortAddress } from "@/lib/web3/use-wallet";
import { cn } from "@/lib/utils";

export function WalletControl() {
  const wallet = useWallet();

  if (wallet.status === "hydrating") {
    return <WalletButton disabled label="Connect wallet" />;
  }

  if (wallet.status === "wallet-missing") {
    return <WalletButton disabled label="Wallet not detected" tone="warning" />;
  }

  if (wallet.status === "connecting") {
    return <WalletButton disabled label="Connecting" tone="info" />;
  }

  if (wallet.status === "wrong-network") {
    return (
      <WalletButton
        label="Switch to Sepolia"
        tone="warning"
        onClick={() => void wallet.switchToSepolia()}
      />
    );
  }

  if (wallet.status === "connected" && wallet.address) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 font-mono text-xs font-semibold text-emerald-800">
          {shortAddress(wallet.address)}
        </span>
        <WalletButton label="Disconnect" tone="neutral" onClick={wallet.disconnect} />
      </div>
    );
  }

  if (wallet.status === "error") {
    return (
      <div className="flex items-center gap-2">
        <WalletButton label="Connection error" disabled tone="warning" />
        <WalletButton label="Retry" onClick={() => void wallet.connect()} />
      </div>
    );
  }

  return <WalletButton label="Connect wallet" onClick={() => void wallet.connect()} />;
}

function WalletButton({
  label,
  onClick,
  disabled = false,
  tone = "primary",
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "primary" | "neutral" | "warning" | "info";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "min-h-10 rounded-md px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:opacity-70",
        tone === "primary" && "bg-slate-950 text-white hover:bg-slate-800",
        tone === "neutral" && "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
        tone === "warning" && "border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
        tone === "info" && "border border-sky-200 bg-sky-50 text-sky-800",
      )}
    >
      {label}
    </button>
  );
}
