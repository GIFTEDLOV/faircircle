"use client";

import { useEffect, useState } from "react";
import { type Hex } from "viem";
import { Card } from "@/components/ui/card";
import { InlineError } from "@/components/web3/inline-error";
import { TransactionStatus, type TransactionState } from "@/components/web3/transaction-status";
import { createBrowserNoxHandleClient } from "@/lib/nox/client";
import { createFairCirclePublicClient, createFairCircleWalletClient } from "@/lib/web3/clients";
import { useWallet } from "@/lib/web3/use-wallet";
import {
  MAX_SUPPORTED_AMOUNT_FALLBACK,
  fairCircleAbi,
  fairCircleAddress,
  parseCapacitySubmittedReceipt,
  safeWeb3ErrorMessage,
} from "./contract";
import { RoomStatus } from "./room-status";
import { validateCapacity } from "./validation";

type CapacitySubmissionProps = {
  roomId: bigint;
  status: number;
  deadline: bigint;
  isMember: boolean;
  hasSubmitted: boolean;
  onConfirmed: (label: string, hash: Hex) => void;
  onRefresh: () => Promise<void>;
};

export function CapacitySubmission({
  roomId,
  status,
  deadline,
  isMember,
  hasSubmitted,
  onConfirmed,
  onRefresh,
}: CapacitySubmissionProps) {
  const wallet = useWallet();
  const [value, setValue] = useState("");
  const [txState, setTxState] = useState<TransactionState>("idle");
  const [txHash, setTxHash] = useState<Hex>();
  const [txError, setTxError] = useState<string>();
  const [maxSupportedAmount, setMaxSupportedAmount] = useState(MAX_SUPPORTED_AMOUNT_FALLBACK);
  const [nowMs, setNowMs] = useState<number>();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setValue("");
      setTxState("idle");
      setTxHash(undefined);
      setTxError(undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [wallet.address, wallet.chainId]);

  useEffect(() => {
    const update = () => setNowMs(Date.now());
    const timer = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 30_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    createFairCirclePublicClient().readContract({
      address: fairCircleAddress,
      abi: fairCircleAbi,
      functionName: "MAX_SUPPORTED_AMOUNT",
    }).then((result) => {
      if (!cancelled) {
        setMaxSupportedAmount(BigInt(result as bigint));
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const deadlinePassed = nowMs !== undefined && nowMs >= Number(deadline) * 1000;
  const canSubmit = wallet.isConnected &&
    wallet.isSepolia &&
    isMember &&
    status === RoomStatus.CollectingInputs &&
    !deadlinePassed &&
    !hasSubmitted;
  const txActive = ["preparing", "awaiting-wallet", "submitted", "confirming"].includes(txState);

  async function submitCapacity() {
    const capacity = validateCapacity(value, maxSupportedAmount);
    if (!capacity.ok) {
      setTxState("failed");
      setTxError(capacity.message);
      return;
    }
    if (!wallet.provider || !wallet.address || !wallet.isSepolia) {
      setTxState("failed");
      setTxError("Connect a Sepolia wallet before submitting.");
      return;
    }
    try {
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
      const encrypted = await handleClient.encryptInput(capacity.value, "uint256", fairCircleAddress);
      const simulation = await publicClient.simulateContract({
        address: fairCircleAddress,
        abi: fairCircleAbi,
        functionName: "submitPrivateCapacity",
        args: [roomId, encrypted.handle as Hex, encrypted.handleProof as Hex],
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
      parseCapacitySubmittedReceipt(receipt, { roomId, member: wallet.address });
      setValue("");
      setTxState("confirmed");
      onConfirmed("Capacity submitted", hash);
      await onRefresh();
    } catch (error) {
      setTxState("failed");
      setTxError(safeWeb3ErrorMessage(error));
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Private capacity</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Enter a nonnegative whole-number amount. It is encrypted before it is submitted.
        </p>
      </div>

      {!isMember ? <InlineError message="Only listed members can submit a private capacity." /> : null}
      {deadlinePassed ? <InlineError message="The submission deadline has passed." /> : null}
      {hasSubmitted ? <p className="text-sm font-medium text-emerald-700">This wallet has submitted.</p> : null}

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && !txActive) {
            void submitCapacity();
          }
        }}
      >
        <label htmlFor="capacity" className="text-sm font-semibold text-slate-950">
          Amount
        </label>
        <input
          id="capacity"
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={!canSubmit || txActive}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200 disabled:cursor-not-allowed disabled:bg-slate-100"
        />
        <button
          type="submit"
          disabled={!canSubmit || txActive}
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
        >
          Submit private capacity
        </button>
      </form>

      <TransactionStatus state={txState} hash={txHash} error={txError} />
    </Card>
  );
}
