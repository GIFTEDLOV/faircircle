import { StatusBadge } from "@/components/ui/status-badge";

export type TransactionState =
  | "idle"
  | "preparing"
  | "awaiting-wallet"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed";

const labels: Record<TransactionState, string> = {
  idle: "Idle",
  preparing: "Preparing",
  "awaiting-wallet": "Awaiting wallet",
  submitted: "Submitted",
  confirming: "Confirming",
  confirmed: "Confirmed",
  failed: "Failed",
};

const tones: Record<TransactionState, "neutral" | "success" | "warning" | "info"> = {
  idle: "neutral",
  preparing: "info",
  "awaiting-wallet": "warning",
  submitted: "info",
  confirming: "info",
  confirmed: "success",
  failed: "warning",
};

type TransactionStatusProps = {
  state: TransactionState;
  hash?: string;
  error?: string;
};

export function TransactionStatus({ state, hash, error }: TransactionStatusProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-950">Transaction</p>
        <StatusBadge tone={tones[state]}>{labels[state]}</StatusBadge>
      </div>
      {hash ? (
        <a
          href={`https://sepolia.etherscan.io/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block truncate font-mono text-xs text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-teal-800"
        >
          {hash}
        </a>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
