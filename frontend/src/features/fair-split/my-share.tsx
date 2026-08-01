"use client";

import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { Card } from "@/components/ui/card";
import { InlineError } from "@/components/web3/inline-error";
import { LoadingState } from "@/components/web3/loading-state";
import { createBrowserNoxHandleClient } from "@/lib/nox/client";
import { createFairCirclePublicClient, createFairCircleWalletClient } from "@/lib/web3/clients";
import { withTransientRpcRetry } from "@/lib/web3/retry";
import { useWallet } from "@/lib/web3/use-wallet";
import { fairCircleAbi, fairCircleAddress, safeWeb3ErrorMessage } from "./contract";

export function MyShare({ roomId, sharesReady }: { roomId: bigint; sharesReady: boolean }) {
  const wallet = useWallet();
  const [share, setShare] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => { setShare(undefined); setError(undefined); setLoading(false); }, 0); return () => window.clearTimeout(timer); }, [roomId, wallet.address, wallet.chainId]);

  async function reveal() {
    if (!wallet.provider || !wallet.address || !wallet.isSepolia) { setError("Connect a Sepolia wallet before revealing your share."); return; }
    setLoading(true); setError(undefined);
    try {
      const publicClient = createFairCirclePublicClient();
      const walletClient = createFairCircleWalletClient(wallet.provider, wallet.address);
      const handleClient = await createBrowserNoxHandleClient({ walletClient, account: wallet.address, chainId: wallet.chainId });
      const handle = await withTransientRpcRetry(() => publicClient.readContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "getMyShareHandle", args: [roomId], account: wallet.address }));
      const decrypted = await handleClient.decrypt(handle as Hex);
      if (typeof decrypted.value !== "bigint") throw new Error("Your share could not be read as a whole-number amount.");
      setShare(decrypted.value.toString());
    } catch (cause) {
      setError(/not authorized|decrypt|does not exist|SharesNotReady/i.test(cause instanceof Error ? cause.message : "") ? "This wallet is not authorized to reveal a share yet." : safeWeb3ErrorMessage(cause));
    } finally { setLoading(false); }
  }

  if (!sharesReady) return null;
  return <Card className="space-y-4"><div><h2 className="text-lg font-semibold text-slate-950">My share</h2><p className="mt-2 text-sm leading-6 text-slate-600">Reveal is explicit and remains only in this browser tab&apos;s memory.</p></div>{share !== undefined ? <div className="rounded-md border border-teal-200 bg-teal-50 p-4"><p className="text-xs font-semibold uppercase text-teal-900">Visible only to this connected wallet</p><p className="mt-2 break-words font-mono text-lg font-semibold text-teal-950">{share}</p><button type="button" onClick={() => setShare(undefined)} className="mt-3 rounded-md border border-teal-300 bg-white px-3 py-2 text-sm font-semibold text-teal-900">Hide</button></div> : <button type="button" disabled={loading} onClick={() => void reveal()} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-60">Reveal my share</button>}{loading ? <LoadingState label="Requesting wallet authorization" /> : null}{error ? <InlineError message={error} /> : null}</Card>;
}
