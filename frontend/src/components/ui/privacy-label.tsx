type PrivacyLabelProps = {
  children: string;
};

export function PrivacyLabel({ children }: PrivacyLabelProps) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white"
      >
        P
      </span>
      <p className="leading-6">{children}</p>
    </div>
  );
}
