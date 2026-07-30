import { CopyAddressButton } from "./copy-address-button";

type ContractAddressProps = {
  label: string;
  address: string;
};

export function ContractAddress({ label, address }: ContractAddressProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-slate-950">{label}</p>
        <a
          href={`https://sepolia.etherscan.io/address/${address}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-teal-800"
        >
          {address}
        </a>
      </div>
      <CopyAddressButton address={address} label={label} />
    </div>
  );
}
