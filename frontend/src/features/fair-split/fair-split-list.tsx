"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PrivacyLabel } from "@/components/ui/privacy-label";
import { StatusBadge } from "@/components/ui/status-badge";
import { InlineError } from "@/components/web3/inline-error";
import { LoadingState } from "@/components/web3/loading-state";
import { NetworkGuard } from "@/components/web3/network-guard";
import { WalletGuard } from "@/components/web3/wallet-guard";
import { shortAddress, useWallet } from "@/lib/web3/use-wallet";
import { roomStatusLabel, roomStatusTone } from "@/features/quiet-budget/room-status";
import { useRoomHistoryRooms } from "@/features/quiet-budget/use-quiet-budget-rooms";

export function FairSplitList() {
  const wallet = useWallet();
  return <AppShell><div className="space-y-8"><PageHeader eyebrow="FairSplit" title="FairSplit rooms" description="Split public costs equally or using private member capacity." actions={<Link href="/fair-split/create" className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Create FairSplit room</Link>} /><PrivacyLabel>{wallet.isConnected ? "Only FairSplit rooms involving this connected wallet are shown. Member addresses and costs are public; private capacities and shares remain confidential." : "Connect a wallet to find FairSplit rooms involving you. Private capacities and shares remain confidential."}</PrivacyLabel>{!wallet.isConnected ? <Card><h2 className="text-lg font-semibold text-slate-950">Connect to see your rooms</h2><p className="mt-2 text-sm leading-6 text-slate-600">FairCircle shows confirmed FairSplit rooms where your wallet is the organizer or a listed member.</p><WalletGuard><span /></WalletGuard></Card> : <NetworkGuard><ConnectedFairSplitRooms account={wallet.address} /></NetworkGuard>}</div></AppShell>;
}

function ConnectedFairSplitRooms({ account }: { account?: `0x${string}` }) {
  const rooms = useRoomHistoryRooms({ account, enabled: account !== undefined, mode: "fair-split" });
  return <div className="space-y-5"><div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold text-slate-950">Wallet rooms</h2><p className="mt-1 text-sm text-slate-600">Confirmed FairSplit rooms discovered from Sepolia logs.</p></div><button type="button" onClick={() => void rooms.refresh()} disabled={rooms.status === "loading"} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-60">Refresh</button></div>{rooms.status === "loading" ? <LoadingState label="Scanning confirmed Sepolia rooms" /> : null}{rooms.status === "error" ? <InlineError message={rooms.error} /> : null}{"partialError" in rooms ? rooms.partialError ? <InlineError message={rooms.partialError} /> : null : null}{"snapshotBlock" in rooms ? <p className="text-xs text-slate-500">Latest scanned block: {rooms.snapshotBlock.toString()}</p> : null}{rooms.status === "success" && rooms.rooms.length === 0 ? <EmptyState title="No wallet-relevant FairSplit rooms" description="No confirmed FairSplit rooms were found where this wallet is the organizer or a listed member." actionLabel="Create FairSplit room" actionHref="/fair-split/create" /> : null}<div className="grid gap-4">{rooms.rooms.map((item) => <Card key={item.room.id.toString()} className="space-y-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold text-teal-700">Room #{item.room.id.toString()}</p><h3 className="mt-1 break-words text-xl font-semibold text-slate-950">{item.room.title}</h3></div><StatusBadge tone={roomStatusTone(item.room.status)}>{roomStatusLabel(item.room.status)}</StatusBadge></div><dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><Metric label="Organizer" value={shortAddress(item.room.organizer)} /><Metric label="Your role" value={item.role} /><Metric label="Members" value={item.room.memberCount.toString()} /><Metric label="Submissions" value={`${item.room.submissionCount}/${item.room.memberCount}`} /><Metric label="Deadline" value={new Date(Number(item.room.submissionDeadline) * 1000).toLocaleString()} /><Metric label="Capacity" value={item.hasSubmitted ? "Submitted" : "Not submitted"} /><Metric label="Mode" value={item.room.mode === 1 ? "FairSplit" : "Unknown"} /><Metric label="Split" value="Open room for method" /></dl><Link href={`/fair-split/${item.room.id.toString()}`} className="inline-flex rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Open room</Link></Card>)}</div></div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-900">{value}</dd></div>; }
