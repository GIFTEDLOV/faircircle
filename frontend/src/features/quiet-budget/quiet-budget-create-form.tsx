"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { type Address, type Hex } from "viem";
import { NetworkGuard } from "@/components/web3/network-guard";
import { TransactionStatus, type TransactionState } from "@/components/web3/transaction-status";
import { WalletGuard } from "@/components/web3/wallet-guard";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { PrivacyLabel } from "@/components/ui/privacy-label";
import { InlineError } from "@/components/web3/inline-error";
import { createFairCirclePublicClient, createFairCircleWalletClient } from "@/lib/web3/clients";
import { withTransientRpcRetry } from "@/lib/web3/retry";
import { useWallet } from "@/lib/web3/use-wallet";
import {
  MAX_SUPPORTED_AMOUNT_FALLBACK,
  fairCircleAbi,
  fairCircleAddress,
  parseRoomCreatedReceipt,
  safeWeb3ErrorMessage,
} from "./contract";
import { RoomMode } from "./room-status";
import {
  deadlineInputToUnixSeconds,
  errorsToText,
  validateMembers,
  validateOptions,
  validateTitle,
} from "./validation";

export function QuietBudgetCreateForm() {
  const wallet = useWallet();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState(["", ""]);
  const [options, setOptions] = useState([""]);
  const [deadline, setDeadline] = useState("");
  const [maxSupportedAmount, setMaxSupportedAmount] = useState(MAX_SUPPORTED_AMOUNT_FALLBACK);
  const [txState, setTxState] = useState<TransactionState>("idle");
  const [txHash, setTxHash] = useState<Hex>();
  const [txError, setTxError] = useState<string>();
  const operationRef = useRef(0);

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
    const publicClient = createFairCirclePublicClient();
    withTransientRpcRetry(() => publicClient.readContract({
      address: fairCircleAddress,
      abi: fairCircleAbi,
      functionName: "MAX_SUPPORTED_AMOUNT",
    })).then((value) => {
      if (!cancelled) {
        setMaxSupportedAmount(BigInt(value as bigint));
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const localError = useMemo(() => {
    const errors = [
      ...validateTitle(title),
    ];
    const memberResult = validateMembers(members);
    const optionResult = validateOptions(options, maxSupportedAmount);
    const deadlineResult = deadlineInputToUnixSeconds(deadline);
    if (!memberResult.ok) {
      errors.push(...memberResult.errors);
    }
    if (!optionResult.ok) {
      errors.push(...optionResult.errors);
    }
    if (!deadlineResult.ok) {
      errors.push({ field: "deadline", message: deadlineResult.message });
    }
    return errorsToText(errors);
  }, [deadline, maxSupportedAmount, members, options, title]);

  const txActive = ["preparing", "awaiting-wallet", "submitted", "confirming"].includes(txState);

  async function submit() {
    const operation = operationRef.current;
    setTxError(undefined);
    setTxHash(undefined);
    const titleErrors = validateTitle(title);
    const memberResult = validateMembers(members);
    const optionResult = validateOptions(options, maxSupportedAmount);
    const deadlineResult = deadlineInputToUnixSeconds(deadline);
    if (titleErrors.length > 0 || !memberResult.ok || !optionResult.ok || !deadlineResult.ok) {
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
      const args = [
        title.trim(),
        memberResult.members,
        optionResult.values,
        deadlineResult.value,
        RoomMode.QuietBudget,
      ] as const;
      const simulation = await withTransientRpcRetry(() => publicClient.simulateContract({
          address: fairCircleAddress,
          abi: fairCircleAbi,
          functionName: "createQuietBudgetRoom",
          args,
          account: wallet.address,
        }));
      if (operation !== operationRef.current) {
        return;
      }
      setTxState("awaiting-wallet");
      const hash = await walletClient.writeContract(simulation.request);
      setTxHash(hash);
      setTxState("submitted");
      setTxState("confirming");
      const receipt = await withTransientRpcRetry(() => publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
          onReplaced: (replacement) => {
            setTxHash(replacement.transaction.hash);
            setTxState("confirming");
          },
        }));
      if (operation !== operationRef.current) {
        return;
      }
      if (receipt.status !== "success") {
        throw new Error("The confirmed transaction was reverted.");
      }
      const created = parseRoomCreatedReceipt(receipt, { organizer: wallet.address });
      setTxState("confirmed");
      router.push(`/quiet-budget/${created.roomId.toString()}`);
    } catch (error) {
      if (operation !== operationRef.current) {
        return;
      }
      setTxState("failed");
      setTxError(safeWeb3ErrorMessage(error));
    }
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="QuietBudget"
          title="Create private budget"
          description="Create a live Sepolia room. The creator is the organizer; only listed members can privately submit capacities."
        />
        <WalletGuard>
          <NetworkGuard>
            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <Card>
                <form
                  className="space-y-6"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!txActive) {
                      void submit();
                    }
                  }}
                >
                  <Field label="Title" htmlFor="title" hint="Shown publicly for this room.">
                    <input
                      id="title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={80}
                      className={inputClass}
                      disabled={txActive}
                    />
                  </Field>

                  <DynamicAddressFields
                    values={members}
                    setValues={setMembers}
                    disabled={txActive}
                    walletAddress={wallet.address}
                  />

                  <DynamicOptionFields
                    values={options}
                    setValues={setOptions}
                    disabled={txActive}
                  />

                  <Field
                    label="Submission deadline"
                    htmlFor="deadline"
                    hint="Members can submit until this future time."
                  >
                    <input
                      id="deadline"
                      type="datetime-local"
                      value={deadline}
                      onChange={(event) => setDeadline(event.target.value)}
                      className={inputClass}
                      disabled={txActive}
                    />
                  </Field>

                  {localError ? <InlineError message={localError} /> : null}

                  <button
                    type="submit"
                    disabled={txActive}
                    className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
                  >
                    Create private budget
                  </button>
                </form>
              </Card>

              <aside className="space-y-4">
                <TransactionStatus state={txState} hash={txHash} error={txError} />
                <PrivacyLabel>
                  Member addresses and option costs are public. Submitted capacity values are
                  encrypted before submission and remain confidential. QuietBudget uses whole-number
                  amount units.
                </PrivacyLabel>
                <Card>
                  <h2 className="text-lg font-semibold text-slate-950">Before creating</h2>
                  <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
                    <li>The connected wallet becomes the organizer.</li>
                    <li>The organizer is not automatically a member.</li>
                    <li>Use “Add my wallet as a member” if the organizer should submit too.</li>
                  </ul>
                </Card>
              </aside>
            </div>
          </NetworkGuard>
        </WalletGuard>
      </div>
    </AppShell>
  );
}

const inputClass = "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200 disabled:cursor-not-allowed disabled:bg-slate-100";

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-slate-950">
        {label}
      </label>
      <p className="mt-1 text-sm text-slate-600">{hint}</p>
      {children}
    </div>
  );
}

function DynamicAddressFields({
  values,
  setValues,
  disabled,
  walletAddress,
}: {
  values: string[];
  setValues: (values: string[]) => void;
  disabled: boolean;
  walletAddress?: Address;
}) {
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">Members</h2>
          <p className="mt-1 text-sm text-slate-600">Add 2 to 8 wallet addresses.</p>
        </div>
        <button
          type="button"
          disabled={disabled || !walletAddress}
          onClick={() => {
            if (walletAddress && !values.some((value) => value.trim().toLowerCase() === walletAddress.toLowerCase())) {
              setValues([...values, walletAddress]);
            }
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:border-teal-400 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
        >
          Add my wallet as a member
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {values.map((value, index) => (
          <div key={index} className="flex gap-2">
            <input
              aria-label={`Member address ${index + 1}`}
              value={value}
              onChange={(event) => {
                const next = [...values];
                next[index] = event.target.value;
                setValues(next);
              }}
              className={inputClass}
              disabled={disabled}
            />
            <button
              type="button"
              disabled={disabled || values.length <= 2}
              onClick={() => setValues(values.filter((_, current) => current !== index))}
              className="mt-2 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || values.length >= 8}
        onClick={() => setValues([...values, ""])}
        className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
      >
        Add member
      </button>
    </div>
  );
}

function DynamicOptionFields({
  values,
  setValues,
  disabled,
}: {
  values: string[];
  setValues: (values: string[]) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-950">Option costs</h2>
      <p className="mt-1 text-sm text-slate-600">Add 1 to 4 unique positive whole-number amounts.</p>
      <div className="mt-3 space-y-3">
        {values.map((value, index) => (
          <div key={index} className="flex gap-2">
            <input
              aria-label={`Option cost ${index + 1}`}
              inputMode="numeric"
              value={value}
              onChange={(event) => {
                const next = [...values];
                next[index] = event.target.value;
                setValues(next);
              }}
              className={inputClass}
              disabled={disabled}
            />
            <button
              type="button"
              disabled={disabled || values.length <= 1}
              onClick={() => setValues(values.filter((_, current) => current !== index))}
              className="mt-2 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || values.length >= 4}
        onClick={() => setValues([...values, ""])}
        className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
      >
        Add option
      </button>
    </div>
  );
}
