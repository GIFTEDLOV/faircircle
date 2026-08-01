"use client";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { InlineError } from "@/components/web3/inline-error";
import { LoadingState } from "@/components/web3/loading-state";
import { WalletGuard } from "@/components/web3/wallet-guard";
import { useWallet } from "@/lib/web3/use-wallet";
import { useRoomHistoryRooms } from "@/features/quiet-budget/use-quiet-budget-rooms";
import { NetworkGuard } from "@/components/web3/network-guard";

export function PrivateCircleList() { const wallet = useWallet(); const rooms = useRoomHistoryRooms({ account: wallet.address, enabled: wallet.isConnected && wallet.isSepolia, mode: "private-circle" }); return <AppShell><div className="space-y-8"><PageHeader eyebrow="Private Circle" title="Wallet rooms" description="Only collections involving this wallet are shown. Individual contributions remain confidential." actions={<Link className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/private-circle/create">Create collection</Link>} /><WalletGuard><NetworkGuard>{rooms.status === "loading" ? <LoadingState label="Finding collections" /> : rooms.status === "error" ? <InlineError message={rooms.error} /> : rooms.rooms.length === 0 ? <Card><p className="text-sm text-slate-600">No Private Circle collections involving this wallet were found.</p><button className="mt-4 text-sm font-semibold underline" onClick={() => void rooms.refresh()}>Refresh</button></Card> : <div className="grid gap-4">{rooms.rooms.map((item) => <Card key={item.room.id.toString()} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase text-teal-700">Collection #{item.room.id.toString()}</p><h2 className="mt-1 text-xl font-semibold">{item.room.title}</h2><p className="mt-2 text-sm text-slate-600">{item.role} · {item.room.submissionCount} public room submissions</p></div><Link className="text-sm font-semibold text-teal-800 underline" href={`/private-circle/${item.room.id}`}>Open collection</Link></Card>)}</div>}</NetworkGuard></WalletGuard></div></AppShell>; }
