"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PrivacyLabel } from "@/components/ui/privacy-label";
import { StatusBadge } from "@/components/ui/status-badge";
import { InlineError } from "@/components/web3/inline-error";
import { LoadingState } from "@/components/web3/loading-state";
import { NetworkGuard } from "@/components/web3/network-guard";
import { WalletGuard } from "@/components/web3/wallet-guard";
import { shortAddress, useWallet } from "@/lib/web3/use-wallet";
import { roomStatusLabel, roomStatusTone } from "./room-status";
import { useQuietBudgetRooms } from "./use-quiet-budget-rooms";

export function QuietBudgetList() {
  const wallet = useWallet();

  return (
    <AppShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="QuietBudget"
          title="Private budget rooms"
          description="Create rooms, collect private capacity submissions, and publish only whether each public option works for the group."
          actions={<ButtonLink href="/quiet-budget/create">Create private budget</ButtonLink>}
        />

        <PrivacyLabel>
          A wallet connection is required to find rooms involving your wallet. Member addresses,
          option costs, deadlines, and group-level results are public; submitted capacity amounts
          stay confidential unless the connected member explicitly reveals their own value.
        </PrivacyLabel>

        {!wallet.isConnected ? (
          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-950">Connect to see your rooms</h2>
            <p className="text-sm leading-6 text-slate-600">
              FairCircle reads live Sepolia events and only shows QuietBudget rooms where your
              connected wallet is the organizer, a listed member, or both.
            </p>
            <WalletGuard>
              <span />
            </WalletGuard>
          </Card>
        ) : (
          <NetworkGuard>
            <ConnectedRoomDashboard account={wallet.address} />
          </NetworkGuard>
        )}
      </div>
    </AppShell>
  );
}

function ConnectedRoomDashboard({ account }: { account?: `0x${string}` }) {
  const rooms = useQuietBudgetRooms({ account, enabled: account !== undefined });
  const partialError = "partialError" in rooms ? rooms.partialError : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Wallet rooms</h2>
          <p className="mt-1 text-sm text-slate-600">
            Confirmed QuietBudget rooms discovered from Sepolia logs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void rooms.refresh()}
          disabled={rooms.status === "loading"}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-teal-400 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
        >
          Refresh
        </button>
      </div>

      {rooms.status === "loading" ? <LoadingState label="Scanning confirmed Sepolia rooms" /> : null}
      {rooms.status === "error" ? <InlineError message={rooms.error} /> : null}
      {partialError ? <InlineError message={partialError} /> : null}
      {"snapshotBlock" in rooms ? (
        <p className="text-xs text-slate-500">Latest scanned block: {rooms.snapshotBlock.toString()}</p>
      ) : null}

      {rooms.status === "success" && rooms.rooms.length === 0 ? (
        <EmptyState
          title="No wallet-relevant QuietBudget rooms"
          description="No confirmed QuietBudget rooms were found where this wallet is the organizer or a listed member."
          actionLabel="Create private budget"
          actionHref="/quiet-budget/create"
        />
      ) : null}

      <div className="grid gap-4">
        {rooms.rooms.map((item) => (
          <Card key={item.room.id.toString()} className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-teal-700">Room #{item.room.id.toString()}</p>
                <h3 className="mt-1 break-words text-xl font-semibold text-slate-950">
                  {item.room.title}
                </h3>
              </div>
              <StatusBadge tone={roomStatusTone(item.room.status)}>
                {roomStatusLabel(item.room.status)}
              </StatusBadge>
            </div>

            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Organizer" value={shortAddress(item.room.organizer)} />
              <Metric label="Your role" value={item.role} />
              <Metric label="Deadline" value={formatDate(item.room.submissionDeadline)} />
              <Metric label="Members" value={item.room.memberCount.toString()} />
              <Metric label="Submissions" value={`${item.room.submissionCount}/${item.room.memberCount}`} />
              <Metric label="Options" value={item.room.optionCount.toString()} />
              <Metric label="Your submission" value={item.hasSubmitted ? "Submitted" : "Not submitted"} />
            </dl>

            <Link
              href={`/quiet-budget/${item.room.id.toString()}`}
              className="inline-flex rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
            >
              Open room
            </Link>
          </Card>
        ))}
      </div>
    </div>
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

function formatDate(value: bigint) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(Number(value) * 1000));
}
