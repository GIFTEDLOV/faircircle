"use client";

import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { Card } from "@/components/ui/card";
import { InlineError } from "@/components/web3/inline-error";
import { TransactionStatus, type TransactionState } from "@/components/web3/transaction-status";
import { createBrowserNoxHandleClient } from "@/lib/nox/client";
import { createFairCirclePublicClient, createFairCircleWalletClient } from "@/lib/web3/clients";
import { withTransientRpcRetry } from "@/lib/web3/retry";
import { useWallet } from "@/lib/web3/use-wallet";
import { fairCircleAbi, fairCircleAddress, parseSplitCapacitySubmittedReceipt, safeWeb3ErrorMessage, MAX_SUPPORTED_AMOUNT_FALLBACK } from "./contract";
import { SplitMethod } from "./contract";
import { validateCapacity } from "@/features/quiet-budget/validation";
import { RoomStatus } from "@/features/quiet-budget/room-status";

export function SplitCapacitySubmission({ roomId, splitMethod, status, deadline, isMember, hasSubmitted, onConfirmed, onRefresh }: { roomId: bigint; splitMethod: number; status: number; deadline: bigint; isMember: boolean; hasSubmitted: boolean; onConfirmed: (label: string, hash: Hex) => void; onRefresh: () => Promise<void> }) {
  const wallet = useWallet();
  const [value, setValue] = useState("");
  const [maxAmount, setMaxAmount] = useState(MAX_SUPPORTED_AMOUNT_FALLBACK);
  const [txState, setTxState] = useState<TransactionState>("idle");
  const [txHash, setTxHash] = useState<Hex>();
  const [txError, setTxError] = useState<string>();
  const [optimisticSubmitted, setOptimisticSubmitted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const operationRef = useRef(0);
  const deadlinePassed = now >= Number(deadline) * 1000;
  const canSubmit = splitMethod === SplitMethod.CapacityWeighted && wallet.isConnected && wallet.isSepolia && isMember && status === RoomStatus.CollectingInputs && !deadlinePassed && !hasSubmitted && !optimisticSubmitted;
  const txActive = ["preparing", "awaiting-wallet", "submitted", "confirming"].includes(txState);

  useEffect(() => {
    operationRef.current += 1;
    const reset = window.setTimeout(() => { setValue(""); setTxState("idle"); setTxHash(undefined); setTxError(undefined); setOptimisticSubmitted(false); }, 0);
    return () => window.clearTimeout(reset);
  }, [wallet.address, wallet.chainId, roomId]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { let cancelled = false; const client = createFairCirclePublicClient(); withTransientRpcRetry(() => client.readContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "MAX_SUPPORTED_AMOUNT" })).then((result) => { if (!cancelled) setMaxAmount(BigInt(result as bigint)); }).catch(() => undefined); return () => { cancelled = true; }; }, []);

  async function submit() {
    const operation = operationRef.current;
    const parsed = validateCapacity(value, maxAmount);
    if (!parsed.ok) { setTxState("failed"); setTxError(parsed.message); return; }
    if (!wallet.provider || !wallet.address || !wallet.isSepolia) { setTxState("failed"); setTxError("Connect a Sepolia wallet before submitting."); return; }
    try {
      setTxState("preparing"); setTxError(undefined); setTxHash(undefined);
      const publicClient = createFairCirclePublicClient();
      const walletClient = createFairCircleWalletClient(wallet.provider, wallet.address);
      const handleClient = await createBrowserNoxHandleClient({ walletClient, account: wallet.address, chainId: wallet.chainId });
      const encrypted = await handleClient.encryptInput(parsed.value, "uint256", fairCircleAddress);
      if (operation !== operationRef.current) return;
      const simulation = await withTransientRpcRetry(() => publicClient.simulateContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "submitSplitCapacity", args: [roomId, encrypted.handle as Hex, encrypted.handleProof as Hex], account: wallet.address }));
      if (operation !== operationRef.current) return;
      setTxState("awaiting-wallet");
      const hash = await walletClient.writeContract(simulation.request);
      setTxHash(hash); setTxState("submitted"); setTxState("confirming");
      const receipt = await withTransientRpcRetry(() => publicClient.waitForTransactionReceipt({ hash, confirmations: 1 }));
      if (operation !== operationRef.current) return;
      if (receipt.status !== "success") throw new Error("The confirmed transaction was reverted.");
      parseSplitCapacitySubmittedReceipt(receipt, { roomId, member: wallet.address });
      setValue(""); setOptimisticSubmitted(true); setTxState("confirmed"); onConfirmed("Capacity submitted", hash);
      try { await onRefresh(); } catch { /* Receipt is authoritative if the follow-up read is unavailable. */ }
    } catch (error) {
      if (operation !== operationRef.current) return;
      setTxState("failed"); setTxError(safeWeb3ErrorMessage(error));
    }
  }

  if (splitMethod !== SplitMethod.CapacityWeighted) return null;
  return <Card className="space-y-4"><div><h2 className="text-lg font-semibold text-slate-950">Private capacity</h2><p className="mt-2 text-sm leading-6 text-slate-600">Enter a nonnegative whole-number capacity. It is encrypted before submission.</p></div>{!isMember ? <InlineError message="Only listed members can submit capacity." /> : null}{deadlinePassed ? <InlineError message="The submission deadline has passed." /> : null}{hasSubmitted || optimisticSubmitted ? <p className="text-sm font-medium text-emerald-700">This wallet has submitted.</p> : null}<form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (canSubmit && !txActive) void submit(); }}><label htmlFor="split-capacity" className="text-sm font-semibold text-slate-950">Capacity</label><input id="split-capacity" inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} disabled={!canSubmit || txActive} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 disabled:bg-slate-100" /><button type="submit" disabled={!canSubmit || txActive} className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Submit private capacity</button></form><TransactionStatus state={txState} hash={txHash} error={txError} /></Card>;
}
