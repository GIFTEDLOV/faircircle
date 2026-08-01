"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Address, Hex } from "viem";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { PrivacyLabel } from "@/components/ui/privacy-label";
import { InlineError } from "@/components/web3/inline-error";
import { NetworkGuard } from "@/components/web3/network-guard";
import { TransactionStatus, type TransactionState } from "@/components/web3/transaction-status";
import { WalletGuard } from "@/components/web3/wallet-guard";
import { createFairCirclePublicClient, createFairCircleWalletClient } from "@/lib/web3/clients";
import { withTransientRpcRetry } from "@/lib/web3/retry";
import { useWallet } from "@/lib/web3/use-wallet";
import {
  fairCircleAbi,
  fairCircleAddress,
  MAX_SUPPORTED_AMOUNT_FALLBACK,
  parseFairSplitRoomCreatedReceipt,
  safeWeb3ErrorMessage,
  SplitMethod,
} from "./contract";
import { fairSplitErrors, validateMembers, validateTotalCost, deadlineInputToUnixSeconds } from "./validation";

export function FairSplitCreateForm() {
  const wallet = useWallet();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState(["", ""]);
  const [totalCost, setTotalCost] = useState("");
  const [deadline, setDeadline] = useState("");
  const [splitMethod, setSplitMethod] = useState<number>(SplitMethod.Equal);
  const [maxSupportedAmount, setMaxSupportedAmount] = useState(MAX_SUPPORTED_AMOUNT_FALLBACK);
  const [txState, setTxState] = useState<TransactionState>("idle");
  const [txHash, setTxHash] = useState<Hex>();
  const [txError, setTxError] = useState<string>();
  const operationRef = useRef(0);
  const txActive = ["preparing", "awaiting-wallet", "submitted", "confirming"].includes(txState);

  useEffect(() => {
    operationRef.current += 1;
    const timer = window.setTimeout(() => {
      setTxState("idle");
      setTxHash(undefined);
      setTxError(undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [wallet.address, wallet.chainId]);

  useEffect(() => {
    let cancelled = false;
    const client = createFairCirclePublicClient();
    withTransientRpcRetry(() => client.readContract({
      address: fairCircleAddress,
      abi: fairCircleAbi,
      functionName: "MAX_SUPPORTED_AMOUNT",
    })).then((value) => {
      if (!cancelled) setMaxSupportedAmount(BigInt(value as bigint));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const localError = useMemo(() => fairSplitErrors({
    title,
    members,
    totalCost,
    deadline,
    maxSupportedAmount,
  }), [deadline, maxSupportedAmount, members, title, totalCost]);

  async function submit() {
    const operation = operationRef.current;
    setTxError(undefined);
    setTxHash(undefined);
    const memberResult = validateMembers(members);
    const costResult = validateTotalCost(totalCost, maxSupportedAmount);
    const deadlineResult = deadlineInputToUnixSeconds(deadline);
    if (localError || !memberResult.ok || !costResult.ok || !deadlineResult.ok) {
      setTxState("failed");
      setTxError(localError || "Fix the form before creating the room.");
      return;
    }
    if (!wallet.provider || !wallet.address || !wallet.isSepolia) {
      setTxState("failed");
      setTxError("Connect a Sepolia wallet before creating a room.");
      return;
    }
    try {
      setTxState("preparing");
      const publicClient = createFairCirclePublicClient();
      const walletClient = createFairCircleWalletClient(wallet.provider, wallet.address);
      const simulation = await withTransientRpcRetry(() => publicClient.simulateContract({
        address: fairCircleAddress,
        abi: fairCircleAbi,
        functionName: "createFairSplitRoom",
        args: [title.trim(), memberResult.members, costResult.value, deadlineResult.value, splitMethod],
        account: wallet.address,
      }));
      if (operation !== operationRef.current) return;
      setTxState("awaiting-wallet");
      const hash = await walletClient.writeContract(simulation.request);
      setTxHash(hash);
      setTxState("submitted");
      setTxState("confirming");
      const receipt = await withTransientRpcRetry(() => publicClient.waitForTransactionReceipt({ hash, confirmations: 1 }));
      if (operation !== operationRef.current) return;
      if (receipt.status !== "success") throw new Error("The confirmed transaction was reverted.");
      const created = parseFairSplitRoomCreatedReceipt(receipt, { organizer: wallet.address, splitMethod });
      setTxState("confirmed");
      router.push(`/fair-split/${created.roomId.toString()}`);
    } catch (error) {
      if (operation !== operationRef.current) return;
      setTxState("failed");
      setTxError(safeWeb3ErrorMessage(error));
    }
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <PageHeader eyebrow="FairSplit" title="Create a FairSplit room" description="Divide a public cost equally or according to private capacity." />
        <WalletGuard>
          <NetworkGuard>
            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <Card>
                <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); if (!txActive) void submit(); }}>
                  <Field label="Title" htmlFor="fair-split-title" hint="Shown publicly for this room.">
                    <input id="fair-split-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} className={inputClass} disabled={txActive} />
                  </Field>
                  <AddressFields values={members} setValues={setMembers} disabled={txActive} walletAddress={wallet.address} />
                  <Field label="Total cost" htmlFor="fair-split-total-cost" hint="Use a positive whole-number amount.">
                    <input id="fair-split-total-cost" inputMode="numeric" value={totalCost} onChange={(event) => setTotalCost(event.target.value)} className={inputClass} disabled={txActive} />
                  </Field>
                  <Field label="Split method" htmlFor="fair-split-method" hint="Equal shares need no private capacity. Capacity-weighted shares do.">
                    <select id="fair-split-method" value={splitMethod} onChange={(event) => setSplitMethod(Number(event.target.value))} className={inputClass} disabled={txActive}>
                      <option value={SplitMethod.Equal}>Equal split</option>
                      <option value={SplitMethod.CapacityWeighted}>Capacity-weighted split</option>
                    </select>
                  </Field>
                  <Field label="Submission deadline" htmlFor="fair-split-deadline" hint="Capacity-weighted members can submit until this future time.">
                    <input id="fair-split-deadline" type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} className={inputClass} disabled={txActive} />
                  </Field>
                  {localError ? <InlineError message={localError} /> : null}
                  <button type="submit" disabled={txActive} className={buttonClass}>Create FairSplit room</button>
                </form>
              </Card>
              <aside className="space-y-4">
                <TransactionStatus state={txState} hash={txHash} error={txError} />
                <PrivacyLabel>Member addresses and the total cost are public. Capacity submissions and each member&apos;s share remain private to that member unless the contract makes a group feasibility result public.</PrivacyLabel>
              </aside>
            </div>
          </NetworkGuard>
        </WalletGuard>
      </div>
    </AppShell>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint: string; children: ReactNode }) {
  return <div><label htmlFor={htmlFor} className="text-sm font-semibold text-slate-950">{label}</label><p className="mt-1 text-sm text-slate-600">{hint}</p>{children}</div>;
}

function AddressFields({ values, setValues, disabled, walletAddress }: { values: string[]; setValues: (values: string[]) => void; disabled: boolean; walletAddress?: Address }) {
  return <div><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-sm font-semibold text-slate-950">Members</h2><p className="mt-1 text-sm text-slate-600">Add 2 to 8 wallet addresses.</p></div><button type="button" disabled={disabled || !walletAddress} onClick={() => { if (walletAddress && !values.some((value) => value.trim().toLowerCase() === walletAddress.toLowerCase())) setValues([...values, walletAddress]); }} className={secondaryButtonClass}>Add my wallet as a member</button></div><div className="mt-3 space-y-3">{values.map((value, index) => <div key={index} className="flex gap-2"><input aria-label={`Member address ${index + 1}`} value={value} onChange={(event) => { const next = [...values]; next[index] = event.target.value; setValues(next); }} className={inputClass} disabled={disabled} /><button type="button" disabled={disabled || values.length <= 2} onClick={() => setValues(values.filter((_, current) => current !== index))} className={secondaryButtonClass}>Remove</button></div>)}</div><button type="button" disabled={disabled || values.length >= 8} onClick={() => setValues([...values, ""])} className={`${secondaryButtonClass} mt-3`}>Add member</button></div>;
}

const inputClass = "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200 disabled:cursor-not-allowed disabled:bg-slate-100";
const buttonClass = "rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950";
const secondaryButtonClass = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:border-teal-400 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950";
