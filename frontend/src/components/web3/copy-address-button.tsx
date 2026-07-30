"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/web3/use-wallet";

type CopyAddressButtonProps = {
  address: string;
  label?: string;
  compact?: boolean;
};

export function CopyAddressButton({
  address,
  label,
  compact = false,
}: CopyAddressButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "rounded-md border border-slate-200 bg-white font-mono text-xs text-slate-700 transition hover:border-teal-300 hover:text-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950",
        compact ? "px-2 py-1" : "px-3 py-2",
      )}
      aria-label={`Copy ${label ?? "address"} ${address}`}
    >
      {copied ? "Copied" : shortAddress(address)}
    </button>
  );
}
