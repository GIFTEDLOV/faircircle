"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { type Hex } from "viem";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { PrivacyLabel } from "@/components/ui/privacy-label";
import { StatusBadge } from "@/components/ui/status-badge";
import { ContractAddress } from "@/components/web3/contract-address";
import { CopyAddressButton } from "@/components/web3/copy-address-button";
import { InlineError } from "@/components/web3/inline-error";
import { LoadingState } from "@/components/web3/loading-state";
import { NetworkGuard } from "@/components/web3/network-guard";
import { TransactionStatus, type TransactionState } from "@/components/web3/transaction-status";
import { WalletGuard } from "@/components/web3/wallet-guard";
import { createBrowserNoxHandleClient } from "@/lib/nox/client";
import { createFairCirclePublicClient, createFairCircleWalletClient } from "@/lib/web3/clients";
import { withTransientRpcRetry } from "@/lib/web3/retry";
import { shortAddress, useWallet } from "@/lib/web3/use-wallet";
import { AffordabilityResults } from "./affordability-results";
import { CapacitySubmission } from "./capacity-submission";
import {
  fairCircleAbi,
  fairCircleAddress,
  parseRoomCancelledReceipt,
  safeWeb3ErrorMessage,
  sepoliaTxUrl,
} from "./contract";
import { roomStatusLabel, roomStatusTone, RoomStatus } from "./room-status";
import type { QuietBudgetRoomState } from "./use-quiet-budget-room";
import { useQuietBudgetRoom } from "./use-quiet-budget-room";

type QuietBudgetRoomProps = {
  roomIdText: string;
};

type SessionTx = {
  label: string;
  hash: Hex;
};

export function QuietBudgetRoom({ roomIdText }: QuietBudgetRoomProps) {
  const wallet = useWallet();
  const roomId = useMemo(() => parseRoomId(roomIdText), [roomIdText]);
  const roomState = useQuietBudgetRoom({
    roomId,
    account: wallet.address,
    enabled: roomId !== undefined && wallet.isSepolia,
  });
  const [sessionTxs, setSessionTxs] = useState<SessionTx[]>([]);
  const [revealedCapacity, setRevealedCapacity] = useState<string>();
  const [revealError, setRevealError] = useState<string>();
  const [revealLoading, setRevealLoading] = useState(false);
  const [cancelTxState, setCancelTxState] = useState<TransactionState>("idle");
  const [cancelTxHash, setCancelTxHash] = useState<Hex>();
  const [cancelTxError, setCancelTxError] = useState<string>();
  const sessionKey = `${wallet.address ?? ""}:${wallet.chainId ?? ""}:${roomIdText}`;
  const sessionKeyRef = useRef(sessionKey);

  useEffect(() => {
    sessionKeyRef.current = sessionKey;
    const timer = window.setTimeout(() => {
      setRevealedCapacity(undefined);
      setRevealError(undefined);
      setCancelTxState("idle");
      setCancelTxHash(undefined);
      setCancelTxError(undefined);
      setSessionTxs([]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sessionKey]);

  function addSessionTx(label: string, hash: Hex) {
    if (sessionKeyRef.current !== sessionKey) {
      return;
    }
    setSessionTxs((current) => [{ label, hash }, ...current.filter((item) => item.hash !== hash)]);
  }

  async function revealOwnCapacity() {
    if (!wallet.provider || !wallet.address || !wallet.isSepolia || roomId === undefined) {
      setRevealError("Connect a Sepolia wallet before revealing your own submitted amount.");
      return;
    }
    setRevealLoading(true);
    setRevealError(undefined);
    try {
      const publicClient = createFairCirclePublicClient();
      const walletClient = createFairCircleWalletClient(wallet.provider, wallet.address);
      const handleClient = await createBrowserNoxHandleClient({
        walletClient,
        account: wallet.address,
        chainId: wallet.chainId,
      });
      const handle = await withTransientRpcRetry(() => publicClient.readContract({
        address: fairCircleAddress,
        abi: fairCircleAbi,
        functionName: "getMyCapacityHandle",
        args: [roomId],
        account: wallet.address,
      }));
      const decrypted = await handleClient.decrypt(handle as Hex);
      if (typeof decrypted.value !== "bigint") {
        throw new Error("The submitted amount could not be read as a whole-number amount.");
      }
      setRevealedCapacity(decrypted.value.toString());
    } catch (error) {
      setRevealError(
        /not authorized|decrypt|does not exist/i.test(error instanceof Error ? error.message : "")
          ? "This wallet is not authorized to reveal that submitted amount."
          : safeWeb3ErrorMessage(error),
      );
    } finally {
      setRevealLoading(false);
    }
  }

  async function cancelRoom() {
    if (roomId === undefined || !wallet.provider || !wallet.address || !wallet.isSepolia) {
      return;
    }
    const confirmed = window.confirm(
      "Cancel this QuietBudget room? Cancellation is irreversible and members will no longer be able to submit.",
    );
    if (!confirmed) {
      return;
    }
    const operationSessionKey = sessionKey;
    try {
      setCancelTxState("preparing");
      setCancelTxError(undefined);
      setCancelTxHash(undefined);
      const publicClient = createFairCirclePublicClient();
      const walletClient = createFairCircleWalletClient(wallet.provider, wallet.address);
      const simulation = await withTransientRpcRetry(() => publicClient.simulateContract({
          address: fairCircleAddress,
          abi: fairCircleAbi,
          functionName: "cancelRoom",
          args: [roomId],
          account: wallet.address,
        }));
      if (sessionKeyRef.current !== operationSessionKey) {
        return;
      }
      setCancelTxState("awaiting-wallet");
      const hash = await walletClient.writeContract(simulation.request);
      setCancelTxHash(hash);
      setCancelTxState("submitted");
      setCancelTxState("confirming");
      const receipt = await withTransientRpcRetry(() => publicClient.waitForTransactionReceipt({ hash, confirmations: 1 }));
      if (sessionKeyRef.current !== operationSessionKey) {
        return;
      }
      if (receipt.status !== "success") {
        throw new Error("The confirmed transaction was reverted.");
      }
      parseRoomCancelledReceipt(receipt, { roomId });
      setCancelTxState("confirmed");
      addSessionTx("Room cancelled", hash);
      try {
        await roomState.refresh();
      } catch {
        // The confirmed transaction remains successful even if the follow-up read is unavailable.
      }
    } catch (error) {
      if (sessionKeyRef.current !== operationSessionKey) {
        return;
      }
      setCancelTxState("failed");
      setCancelTxError(safeWeb3ErrorMessage(error));
    }
  }

  if (roomId === undefined) {
    return (
      <AppShell>
        <InlineError message="Use a valid numeric QuietBudget room ID." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="QuietBudget"
          title={`Room #${roomId.toString()}`}
          description="Live public room state from Ethereum Sepolia."
          actions={<Link className="text-sm font-semibold text-teal-800 underline" href="/quiet-budget">Back to rooms</Link>}
        />
        <WalletGuard>
          <NetworkGuard>
            {roomState.status === "loading" ? <LoadingState label="Reading room state" /> : null}
            {roomState.status === "error" ? <InlineError message={roomState.error} /> : null}
            {roomState.status === "not-found" ? <InlineError message={roomState.error} /> : null}
            {roomState.status === "success" ? (
              <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
                <div className="space-y-6">
                  <RoomOverview data={roomState.data} account={wallet.address} />
                  <CapacitySubmission
                    roomId={roomId}
                    status={roomState.data.room.status}
                    deadline={roomState.data.room.submissionDeadline}
                    isMember={roomState.data.isMember}
                    hasSubmitted={roomState.data.hasSubmitted}
                    onConfirmed={addSessionTx}
                    onRefresh={roomState.refresh}
                  />
                  {roomState.data.hasSubmitted ? (
                    <Card className="space-y-4">
                      <div>
                        <h2 className="text-lg font-semibold text-slate-950">My submitted amount</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          Reveal is explicit and stays only in this browser tab&apos;s memory.
                        </p>
                      </div>
                      {revealedCapacity ? (
                        <div className="rounded-md border border-teal-200 bg-teal-50 p-4">
                          <p className="text-xs font-semibold uppercase text-teal-900">
                            Visible only to this connected wallet
                          </p>
                          <p className="mt-2 break-words font-mono text-lg font-semibold text-teal-950">
                            {revealedCapacity}
                          </p>
                          <button
                            type="button"
                            onClick={() => setRevealedCapacity(undefined)}
                            className="mt-3 rounded-md border border-teal-300 bg-white px-3 py-2 text-sm font-semibold text-teal-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
                          >
                            Hide
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={revealLoading}
                          onClick={() => void revealOwnCapacity()}
                          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-teal-400 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
                        >
                          Reveal my submitted amount
                        </button>
                      )}
                      {revealLoading ? <LoadingState label="Requesting wallet authorization" /> : null}
                      {revealError ? <InlineError message={revealError} /> : null}
                    </Card>
                  ) : null}
                  <AffordabilityResults
                    roomId={roomId}
                    status={roomState.data.room.status}
                    options={roomState.data.options}
                    results={roomState.data.publicAffordability}
                    onConfirmed={addSessionTx}
                    onRefresh={roomState.refresh}
                  />
                </div>

                <aside className="space-y-4">
                  <ContractAddress label="FairCircle" address={fairCircleAddress} />
                  <PrivacyLabel>
                    Public room data never includes aggregate capacity or individual private amounts.
                    Only the connected member can reveal their own submitted amount.
                  </PrivacyLabel>
                  <SessionTransactions transactions={sessionTxs} />
                  {canCancel(roomState.data, wallet.address) ? (
                    <Card className="space-y-4">
                      <h2 className="text-lg font-semibold text-slate-950">Cancel room</h2>
                      <p className="text-sm leading-6 text-slate-600">
                        The organizer can cancel only while the room is still collecting inputs.
                      </p>
                      <button
                        type="button"
                        disabled={["preparing", "awaiting-wallet", "submitted", "confirming"].includes(cancelTxState)}
                        onClick={() => void cancelRoom()}
                        className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
                      >
                        Cancel room
                      </button>
                      <TransactionStatus state={cancelTxState} hash={cancelTxHash} error={cancelTxError} />
                    </Card>
                  ) : null}
                </aside>
              </div>
            ) : null}
          </NetworkGuard>
        </WalletGuard>
      </div>
    </AppShell>
  );
}

function RoomOverview({ data, account }: { data: QuietBudgetRoomState; account?: string }) {
  const isOrganizer = account !== undefined &&
    data.room.organizer.toLowerCase() === account.toLowerCase();
  const role = isOrganizer && data.isMember
    ? "Organizer and member"
    : isOrganizer
      ? "Organizer"
      : data.isMember
        ? "Member"
        : "Not a member";
  return (
    <Card className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-teal-700">Room #{data.room.id.toString()}</p>
          <h2 className="mt-1 break-words text-2xl font-semibold text-slate-950">{data.room.title}</h2>
        </div>
        <StatusBadge tone={roomStatusTone(data.room.status)}>
          {roomStatusLabel(data.room.status)}
        </StatusBadge>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Organizer" value={shortAddress(data.room.organizer)} />
        <Metric label="Your role" value={role} />
        <Metric label="Status" value={roomStatusLabel(data.room.status)} />
        <Metric label="Deadline" value={formatDate(data.room.submissionDeadline)} />
        <Metric label="Remaining" value={remainingTime(data.room.submissionDeadline)} />
        <Metric label="Submissions" value={`${data.room.submissionCount}/${data.room.memberCount}`} />
        <Metric label="Options" value={data.room.optionCount.toString()} />
        <Metric label="Results published" value={`${data.room.finalizedOptionCount}/${data.room.optionCount}`} />
      </dl>
      <div>
        <h3 className="text-sm font-semibold text-slate-950">Members</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.members.map((member) => (
            <CopyAddressButton key={member} address={member} compact />
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-950">Public option costs</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {data.options.map((option, index) => (
            <div key={index} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Option {index + 1}</p>
              <p className="mt-1 break-words font-mono text-sm text-slate-900">{option.toString()}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function SessionTransactions({ transactions }: { transactions: SessionTx[] }) {
  return (
    <Card>
      <h2 className="text-lg font-semibold text-slate-950">This session</h2>
      {transactions.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">Confirmed transaction links will appear here.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {transactions.map((transaction) => (
            <li key={transaction.hash}>
              <p className="text-sm font-medium text-slate-950">{transaction.label}</p>
              <a
                href={sepoliaTxUrl(transaction.hash)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block break-all font-mono text-xs text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-teal-800"
              >
                {transaction.hash}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-slate-900">{value}</dd>
    </div>
  );
}

function canCancel(data: QuietBudgetRoomState, account?: string) {
  return Boolean(
    account &&
      data.room.organizer.toLowerCase() === account.toLowerCase() &&
      data.room.status === RoomStatus.CollectingInputs,
  );
}

function parseRoomId(value: string) {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : undefined;
}

function formatDate(value: bigint) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(Number(value) * 1000));
}

function remainingTime(value: bigint) {
  const seconds = Number(value) - Math.floor(Date.now() / 1000);
  if (seconds <= 0) {
    return "Deadline passed";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} left`;
  }
  if (hours > 0) {
    return `${hours} hr ${minutes} min left`;
  }
  return `${minutes} min left`;
}
