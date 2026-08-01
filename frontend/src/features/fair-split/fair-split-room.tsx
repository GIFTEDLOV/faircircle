"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Hex } from "viem";
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
import { createFairCirclePublicClient, createFairCircleWalletClient } from "@/lib/web3/clients";
import { withTransientRpcRetry } from "@/lib/web3/retry";
import { shortAddress, useWallet } from "@/lib/web3/use-wallet";
import { SplitCapacitySubmission } from "./split-capacity-submission";
import { SplitFeasibility } from "./split-feasibility";
import { MyShare } from "./my-share";
import { fairCircleAbi, fairCircleAddress, safeWeb3ErrorMessage, sepoliaTxUrl, SplitMethod } from "./contract";
import { RoomStatus, roomStatusLabel, roomStatusTone } from "@/features/quiet-budget/room-status";
import { useFairSplitRoom, type FairSplitRoomState } from "./use-fair-split-room";

export function FairSplitRoom({ roomIdText }: { roomIdText: string }) {
  const wallet = useWallet();
  const roomId = useMemo(() => /^\d+$/.test(roomIdText) && BigInt(roomIdText) > 0n ? BigInt(roomIdText) : undefined, [roomIdText]);
  const roomState = useFairSplitRoom({ roomId, account: wallet.address, enabled: roomId !== undefined && wallet.isSepolia });
  const [sessionTxs, setSessionTxs] = useState<Array<{ label: string; hash: Hex }>>([]);
  const [cancelState, setCancelState] = useState<TransactionState>("idle");
  const [cancelHash, setCancelHash] = useState<Hex>();
  const [cancelError, setCancelError] = useState<string>();
  const sessionKey = `${wallet.address ?? ""}:${wallet.chainId ?? ""}:${roomIdText}`;
  const sessionRef = useRef(sessionKey);
  useEffect(() => { sessionRef.current = sessionKey; const timer = window.setTimeout(() => { setSessionTxs([]); setCancelState("idle"); setCancelHash(undefined); setCancelError(undefined); }, 0); return () => window.clearTimeout(timer); }, [sessionKey]);
  function addTx(label: string, hash: Hex) { if (sessionRef.current !== sessionKey) return; setSessionTxs((current) => [{ label, hash }, ...current.filter((item) => item.hash !== hash)]); }
  async function cancel() {
    if (!roomId || !wallet.provider || !wallet.address || !wallet.isSepolia || roomState.status !== "success" || roomState.data.room.organizer.toLowerCase() !== wallet.address.toLowerCase() || roomState.data.room.status !== RoomStatus.CollectingInputs) return;
    if (!window.confirm("Cancel this FairSplit room? Cancellation is irreversible.")) return;
    const currentKey = sessionKey;
    try {
      setCancelState("preparing"); setCancelError(undefined); setCancelHash(undefined);
      const publicClient = createFairCirclePublicClient(); const walletClient = createFairCircleWalletClient(wallet.provider, wallet.address);
      const simulation = await withTransientRpcRetry(() => publicClient.simulateContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "cancelRoom", args: [roomId], account: wallet.address }));
      if (sessionRef.current !== currentKey) return;
      setCancelState("awaiting-wallet"); const hash = await walletClient.writeContract(simulation.request); setCancelHash(hash); setCancelState("submitted"); setCancelState("confirming");
      const receipt = await withTransientRpcRetry(() => publicClient.waitForTransactionReceipt({ hash, confirmations: 1 }));
      if (receipt.status !== "success") throw new Error("The confirmed transaction was reverted.");
      const event = receipt.logs.find((log) => log.address.toLowerCase() === fairCircleAddress.toLowerCase());
      if (!event) throw new Error("The confirmed receipt is missing RoomCancelled.");
      setCancelState("confirmed"); addTx("Room cancelled", hash); try { await roomState.refresh(); } catch { /* Receipt is authoritative. */ }
    } catch (error) { if (sessionRef.current !== currentKey) return; setCancelState("failed"); setCancelError(safeWeb3ErrorMessage(error)); }
  }
  if (roomId === undefined) return <AppShell><InlineError message="Use a valid numeric FairSplit room ID." /></AppShell>;
  return <AppShell><div className="space-y-8"><PageHeader eyebrow="FairSplit" title={`Room #${roomId.toString()}`} description="Live public room state from Ethereum Sepolia." actions={<Link href="/fair-split" className="text-sm font-semibold text-teal-800 underline">Back to rooms</Link>} /><WalletGuard><NetworkGuard>{roomState.status === "loading" ? <LoadingState label="Reading FairSplit room state" /> : null}{roomState.status === "error" || roomState.status === "not-found" ? <InlineError message={roomState.error} /> : null}{roomState.status === "success" ? <div className="grid gap-6 lg:grid-cols-[1fr_380px]"><div className="space-y-6"><Overview data={roomState.data} account={wallet.address} /><SplitCapacitySubmission roomId={roomId} splitMethod={roomState.data.room.splitMethod} status={roomState.data.room.status} deadline={roomState.data.room.submissionDeadline} isMember={roomState.data.isMember} hasSubmitted={roomState.data.hasSubmitted} onConfirmed={addTx} onRefresh={roomState.refresh} /><SplitFeasibility roomId={roomId} splitMethod={roomState.data.room.splitMethod} status={roomState.data.room.status} result={roomState.data.publicFeasibility} onConfirmed={addTx} onRefresh={roomState.refresh} /><MyShare roomId={roomId} sharesReady={roomState.data.sharesReady} /></div><aside className="space-y-4"><ContractAddress label="FairCircle" address={fairCircleAddress} /><PrivacyLabel>Member addresses and total cost are public. Capacity values and individual shares are visible only to the connected member who explicitly reveals their own value.</PrivacyLabel><Card><h2 className="text-lg font-semibold text-slate-950">This session</h2>{sessionTxs.length === 0 ? <p className="mt-3 text-sm text-slate-600">Confirmed transaction links will appear here.</p> : <ul className="mt-3 space-y-3">{sessionTxs.map((item) => <li key={item.hash}><p className="text-sm font-medium text-slate-950">{item.label}</p><a className="mt-1 block break-all font-mono text-xs text-slate-600 underline" href={sepoliaTxUrl(item.hash)} target="_blank" rel="noreferrer">{item.hash}</a></li>)}</ul>}</Card>{roomState.data.room.organizer.toLowerCase() === wallet.address?.toLowerCase() && roomState.data.room.status === RoomStatus.CollectingInputs ? <Card className="space-y-4"><h2 className="text-lg font-semibold text-slate-950">Cancel room</h2><button type="button" disabled={cancelState === "preparing" || cancelState === "awaiting-wallet" || cancelState === "submitted" || cancelState === "confirming"} onClick={() => void cancel()} className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-60">Cancel room</button><TransactionStatus state={cancelState} hash={cancelHash} error={cancelError} /></Card> : null}</aside></div> : null}</NetworkGuard></WalletGuard></div></AppShell>;
}

function Overview({ data, account }: { data: FairSplitRoomState; account?: string }) {
  const isOrganizer = account !== undefined && data.room.organizer.toLowerCase() === account.toLowerCase();
  const role = isOrganizer && data.isMember ? "Organizer and member" : isOrganizer ? "Organizer" : data.isMember ? "Member" : "Not a member";
  return <Card className="space-y-5"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-teal-700">Room #{data.room.id.toString()}</p><h2 className="mt-1 break-words text-2xl font-semibold text-slate-950">{data.room.title}</h2></div><StatusBadge tone={roomStatusTone(data.room.status)}>{roomStatusLabel(data.room.status)}</StatusBadge></div><dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><Metric label="Organizer" value={shortAddress(data.room.organizer)} /><Metric label="Your role" value={role} /><Metric label="Split method" value={data.room.splitMethod === SplitMethod.Equal ? "Equal split" : "Capacity-weighted"} /><Metric label="Total cost" value={data.room.totalCost.toString()} /><Metric label="Members" value={data.room.memberCount.toString()} /><Metric label="Submissions" value={`${data.room.submissionCount}/${data.room.memberCount}`} /><Metric label="Results" value={data.sharesReady ? "Shares ready" : data.publicFeasibility.finalized ? "No shares available" : "Waiting"} /></dl><div><h3 className="text-sm font-semibold text-slate-950">Members</h3><div className="mt-3 flex flex-wrap gap-2">{data.members.map((member) => <CopyAddressButton key={member} address={member} compact />)}</div></div></Card>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-900">{value}</dd></div>; }
