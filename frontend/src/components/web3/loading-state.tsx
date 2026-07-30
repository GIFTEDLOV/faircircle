type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = "Loading" }: LoadingStateProps) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-600" role="status">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-700"
      />
      <span>{label}</span>
    </div>
  );
}
