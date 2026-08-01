"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { type Address } from "viem";
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
import { CollectionAccess, fairCircleAbi, fairCircleAddress, fairCircleUsdAddress, parsePrivateCircleCreatedReceipt, toUnixDeadline, validatePrivateCircleForm } from "./contract";

export function PrivateCircleCreateForm() {
  const wallet = useWallet(); const router = useRouter(); const busy = useRef(false);
  const [title, setTitle] = useState(""); const [recipient, setRecipient] = useState(""); const [access, setAccess] = useState<number>(CollectionAccess.Open); const [invitees, setInvitees] = useState(["", ""]); const [target, setTarget] = useState(""); const [deadline, setDeadline] = useState(""); const [state, setState] = useState<TransactionState>("idle"); const [hash, setHash] = useState<string>(); const [error, setError] = useState<string>();
  async function submit() {
    if (busy.current) return; busy.current = true; setError(undefined); setHash(undefined);
    const errors = validatePrivateCircleForm({ title, recipient, access, invitees, target, deadline });
    if (errors.length || !wallet.address || !wallet.provider || !wallet.isSepolia) { setState("failed"); setError(errors[0] ?? "Connect a Sepolia wallet before creating a collection."); busy.current = false; return; }
    try {
      setState("preparing"); const publicClient = createFairCirclePublicClient(); const walletClient = createFairCircleWalletClient(wallet.provider, wallet.address); const members = access === CollectionAccess.InviteOnly ? invitees.filter(Boolean).map((v) => v.trim() as Address) : [];
      const simulation = await withTransientRpcRetry(() => publicClient.simulateContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "createPrivateCircleRoom", args: [title.trim(), fairCircleUsdAddress, recipient.trim() as Address, target ? BigInt(target) : 0n, toUnixDeadline(deadline), access, members], account: wallet.address }));
      setState("awaiting-wallet"); const tx = await walletClient.writeContract(simulation.request); setHash(tx); setState("confirming"); const receipt = await withTransientRpcRetry(() => publicClient.waitForTransactionReceipt({ hash: tx }));
      if (receipt.status !== "success") throw new Error("The confirmed transaction was reverted."); const created = parsePrivateCircleCreatedReceipt(receipt, wallet.address); setState("confirmed"); router.push(`/private-circle/${created.roomId}`);
    } catch (cause) { setState("failed"); setError(cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/g, "[redacted-url]").slice(0, 300) : "The wallet or Sepolia request failed."); } finally { busy.current = false; }
  }
  return <AppShell><div className="space-y-8"><PageHeader eyebrow="Private Circle" title="Create collection" description="Collect confidential contributions for a configured recipient." /><WalletGuard><NetworkGuard><div className="grid gap-6 lg:grid-cols-[1fr_360px]"><Card><form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <label className="block text-sm font-semibold">Title<input className={inputClass} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label className="block text-sm font-semibold">Recipient address<input className={inputClass} value={recipient} onChange={(e) => setRecipient(e.target.value)} /></label>
    <label className="block text-sm font-semibold">Access<select className={inputClass} value={access} onChange={(e) => setAccess(Number(e.target.value))}><option value={CollectionAccess.Open}>Open</option><option value={CollectionAccess.InviteOnly}>Invite only</option></select></label>
    {access === CollectionAccess.InviteOnly ? <div><p className="text-sm font-semibold">Invitees</p>{invitees.map((value, i) => <input key={i} aria-label={`Invitee ${i + 1}`} className={inputClass} value={value} onChange={(e) => setInvitees(invitees.map((v, n) => n === i ? e.target.value : v))} />)}<button type="button" className={buttonClass} onClick={() => setInvitees([...invitees, ""])} disabled={invitees.length >= 8}>Add invitee</button></div> : null}
    <label className="block text-sm font-semibold">Public target (optional)<input className={inputClass} inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Whole-number units" /></label>
    <label className="block text-sm font-semibold">Deadline<input className={inputClass} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
    <button className={buttonClass} type="submit" disabled={state === "preparing" || state === "awaiting-wallet" || state === "confirming"}>Create collection</button>
    {error ? <InlineError message={error} /> : null}</form></Card><aside className="space-y-4"><TransactionStatus state={state} hash={hash} error={error} /><PrivacyLabel>Member addresses, recipient and target are public. Contributions remain confidential and are revealed only to the connected authorized wallet.</PrivacyLabel><Card><p className="text-sm leading-6 text-slate-600">Private Circle uses test tokens on Sepolia. They are not real money.</p></Card></aside></div></NetworkGuard></WalletGuard></div></AppShell>;
}
const inputClass = "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200";
const buttonClass = "rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60";
