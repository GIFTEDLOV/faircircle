"use client";

import { useRef, useState } from "react";
import type { Hex } from "viem";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { TransactionStatus, type TransactionState } from "@/components/web3/transaction-status";
import { createBrowserNoxHandleClient } from "@/lib/nox/client";
import { createFairCirclePublicClient, createFairCircleWalletClient } from "@/lib/web3/clients";
import { withTransientRpcRetry } from "@/lib/web3/retry";
import { useWallet } from "@/lib/web3/use-wallet";
import { fairCircleAbi, fairCircleAddress, parseSplitFeasibilityFinalizedReceipt, safeWeb3ErrorMessage, SplitMethod, type PublicSplitFeasibility } from "./contract";
import { RoomStatus } from "@/features/quiet-budget/room-status";

export function SplitFeasibility({ roomId, splitMethod, status, result, onConfirmed, onRefresh }: { roomId: bigint; splitMethod: number; status: number; result: PublicSplitFeasibility; onConfirmed: (label: string, hash: Hex) => void; onRefresh: () => Promise<void> }) {
  const wallet = useWallet();
  const [txState, setTxState] = useState<TransactionState>("idle");
  const [txHash, setTxHash] = useState<Hex>();
  const [txError, setTxError] = useState<string>();
  const operationRef = useRef(0);
  const txActive = ["preparing", "awaiting-wallet", "submitted", "confirming"].includes(txState);
  if (splitMethod === SplitMethod.Equal) return <Card className="space-y-4"><h2 className="text-lg font-semibold text-slate-950">Split feasibility</h2><StatusBadge tone="success">Equal split is ready</StatusBadge><p className="text-sm leading-6 text-slate-600">Each member has an equal share of the total cost. No capacity submission or feasibility publication is required.</p><TransactionStatus state={txState} hash={txHash} error={txError} /></Card>;

  async function publish() {
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    if (!wallet.provider || !wallet.address || !wallet.isSepolia) { setTxState("failed"); setTxError("Connect a Sepolia wallet before publishing feasibility."); return; }
    try {
      setTxState("preparing"); setTxError(undefined); setTxHash(undefined);
      const publicClient = createFairCirclePublicClient();
      const walletClient = createFairCircleWalletClient(wallet.provider, wallet.address);
      const handleClient = await createBrowserNoxHandleClient({ walletClient, account: wallet.address, chainId: wallet.chainId });
      const handle = await withTransientRpcRetry(() => publicClient.readContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "getSplitFeasibilityHandle", args: [roomId] }));
      const decrypted = await handleClient.publicDecrypt(handle as Hex);
      if (typeof decrypted.value !== "boolean") throw new Error("The feasibility result was not a valid true-or-false value.");
      if (operation !== operationRef.current) return;
      const simulation = await withTransientRpcRetry(() => publicClient.simulateContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "finalizeSplitFeasibility", args: [roomId, decrypted.decryptionProof as Hex], account: wallet.address }));
      if (operation !== operationRef.current) return;
      setTxState("awaiting-wallet");
      const hash = await walletClient.writeContract(simulation.request);
      setTxHash(hash); setTxState("submitted"); setTxState("confirming");
      const receipt = await withTransientRpcRetry(() => publicClient.waitForTransactionReceipt({ hash, confirmations: 1 }));
      if (operation !== operationRef.current) return;
      if (receipt.status !== "success") throw new Error("The confirmed transaction was reverted.");
      parseSplitFeasibilityFinalizedReceipt(receipt, { roomId, feasible: decrypted.value });
      setTxState("confirmed"); onConfirmed("Feasibility published", hash);
      try { await onRefresh(); } catch { /* Receipt is authoritative if the follow-up read is unavailable. */ }
    } catch (error) {
      if (operation !== operationRef.current) return;
      setTxState("failed"); setTxError(safeWeb3ErrorMessage(error));
    }
  }

  return <Card className="space-y-4"><div><h2 className="text-lg font-semibold text-slate-950">Split feasibility</h2><p className="mt-2 text-sm leading-6 text-slate-600">The public result reveals only whether the group capacity covers the total cost.</p></div><StatusBadge tone={result.finalized ? (result.feasible ? "success" : "warning") : "neutral"}>{result.finalized ? result.feasible ? "Works for the group" : "Does not work for the group" : status === RoomStatus.ReadyForDecryption ? "Ready to publish" : "Waiting for all capacities"}</StatusBadge>{!result.finalized && status === RoomStatus.ReadyForDecryption ? <button type="button" disabled={txActive} onClick={() => void publish()} className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Publish feasibility</button> : null}<TransactionStatus state={txState} hash={txHash} error={txError} /></Card>;
}
