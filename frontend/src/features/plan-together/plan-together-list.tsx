"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/set-state-in-effect */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { InlineError } from "@/components/web3/inline-error";
import { LoadingState } from "@/components/web3/loading-state";
import { NetworkGuard } from "@/components/web3/network-guard";
import { WalletGuard } from "@/components/web3/wallet-guard";
import { useWallet } from "@/lib/web3/use-wallet";
export function PlanTogetherList() { const wallet = useWallet(); const [plans, setPlans] = useState<any[]>([]); const [error, setError] = useState<string>(); const [loading, setLoading] = useState(false); const load = useCallback(async () => { if (!wallet.address || !wallet.isSepolia) return; setLoading(true); try { const response = await fetch(`/api/plan-together/plans?account=${wallet.address}`); const body = await response.json(); if (!body.ok) throw new Error(body.error.message); setPlans(body.plans); } catch (e) { setError(e instanceof Error ? e.message : "Plans could not be loaded. Try again."); } finally { setLoading(false); } }, [wallet.address, wallet.isSepolia]); useEffect(() => { void load(); }, [load]); return <AppShell><div className="space-y-8"><PageHeader eyebrow="Plan Together" title="Wallet plans" description="Only plans involving this wallet are shown." actions={<Link className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/plan-together/create">Create plan</Link>} /><WalletGuard><NetworkGuard>{loading ? <LoadingState label="Finding plans" /> : error ? <InlineError message={error} /> : plans.length === 0 ? <Card><p className="text-sm text-slate-600">No plans involving this wallet were found.</p><button className="mt-3 text-sm underline" onClick={() => void load()}>Refresh</button></Card> : <div className="grid gap-4">{plans.map((item) => <Card key={item.plan.id}><p className="text-xs font-semibold uppercase text-teal-700">Plan #{item.plan.id}</p><h2 className="mt-1 text-xl font-semibold">{item.plan.title}</h2><p className="mt-2 text-sm text-slate-600">Stage {item.plan.stage} · Budget room #{item.plan.budgetRoomId}</p><Link className="mt-4 inline-block text-sm font-semibold text-teal-800 underline" href={`/plan-together/${item.plan.id}`}>Open plan</Link></Card>)}</div>}</NetworkGuard></WalletGuard></div></AppShell>; }
