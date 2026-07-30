"use client";

import { useState } from "react";
import { type Hex } from "viem";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { TransactionStatus, type TransactionState } from "@/components/web3/transaction-status";
import { createBrowserNoxHandleClient } from "@/lib/nox/client";
import { createFairCirclePublicClient, createFairCircleWalletClient } from "@/lib/web3/clients";
import { useWallet } from "@/lib/web3/use-wallet";
import {
  fairCircleAbi,
  fairCircleAddress,
  parseAffordabilityFinalizedReceipt,
  safeWeb3ErrorMessage,
  type PublicAffordability,
} from "./contract";
import { RoomStatus } from "./room-status";

type AffordabilityResultsProps = {
  roomId: bigint;
  status: number;
  options: bigint[];
  results: PublicAffordability[];
  onConfirmed: (label: string, hash: Hex) => void;
  onRefresh: () => Promise<void>;
};

export function AffordabilityResults({
  roomId,
  status,
  options,
  results,
  onConfirmed,
  onRefresh,
}: AffordabilityResultsProps) {
  const wallet = useWallet();
  const [activeOption, setActiveOption] = useState<number>();
  const [txState, setTxState] = useState<TransactionState>("idle");
  const [txHash, setTxHash] = useState<Hex>();
  const [txError, setTxError] = useState<string>();
  const txActive = ["preparing", "awaiting-wallet", "submitted", "confirming"].includes(txState);

  async function publish(index: number) {
    if (!wallet.provider || !wallet.address || !wallet.isSepolia) {
      setTxState("failed");
      setTxError("Connect a Sepolia wallet before publishing.");
      return;
    }
    try {
      setActiveOption(index);
      setTxError(undefined);
      setTxHash(undefined);
      setTxState("preparing");
      const publicClient = createFairCirclePublicClient();
      const walletClient = createFairCircleWalletClient(wallet.provider, wallet.address);
      const handleClient = await createBrowserNoxHandleClient({
        walletClient,
        account: wallet.address,
        chainId: wallet.chainId,
      });
      const handle = await publicClient.readContract({
        address: fairCircleAddress,
        abi: fairCircleAbi,
        functionName: "getAffordabilityHandle",
        args: [roomId, BigInt(index)],
      });
      const decrypted = await handleClient.publicDecrypt(handle as Hex);
      if (typeof decrypted.value !== "boolean") {
        throw new Error("The published result was not a valid true-or-false value.");
      }
      const simulation = await publicClient.simulateContract({
        address: fairCircleAddress,
        abi: fairCircleAbi,
        functionName: "finalizeAffordability",
        args: [roomId, BigInt(index), decrypted.decryptionProof as Hex],
        account: wallet.address,
      });
      setTxState("awaiting-wallet");
      const hash = await walletClient.writeContract(simulation.request);
      setTxHash(hash);
      setTxState("submitted");
      setTxState("confirming");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== "success") {
        throw new Error("The confirmed transaction was reverted.");
      }
      parseAffordabilityFinalizedReceipt(receipt, {
        roomId,
        optionIndex: index,
        affordable: decrypted.value,
      });
      setTxState("confirmed");
      onConfirmed(`Published option ${index + 1}`, hash);
      await onRefresh();
    } catch (error) {
      setTxState("failed");
      setTxError(safeWeb3ErrorMessage(error));
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Affordability results</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Public results reveal only whether each option works for the group, not any member&apos;s
          individual capacity.
        </p>
      </div>
      <div className="space-y-3">
        {options.map((cost, index) => {
          const result = results[index] ?? { finalized: false, affordable: false };
          return (
            <div
              key={index}
              className="flex flex-col gap-3 rounded-md border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-semibold text-slate-950">Option {index + 1}</p>
                <p className="mt-1 break-words font-mono text-sm text-slate-600">{cost.toString()}</p>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                <StatusBadge tone={result.finalized ? (result.affordable ? "success" : "warning") : "neutral"}>
                  {result.finalized
                    ? result.affordable
                      ? "Works for the group"
                      : "Does not work for the group"
                    : "Waiting to be published"}
                </StatusBadge>
                {!result.finalized && status === RoomStatus.ReadyForDecryption ? (
                  <button
                    type="button"
                    disabled={txActive}
                    onClick={() => void publish(index)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:border-teal-400 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
                  >
                    Publish result
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <TransactionStatus
        state={txState}
        hash={txHash}
        error={activeOption === undefined ? txError : txError}
      />
    </Card>
  );
}
