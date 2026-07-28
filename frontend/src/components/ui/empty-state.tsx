import { ButtonLink } from "@/components/ui/button-link";

type EmptyStateProps = {
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
};

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: EmptyStateProps) {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <div
        aria-hidden="true"
        className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-slate-100 text-lg font-bold text-slate-500"
      >
        +
      </div>
      <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        {description}
      </p>
      <ButtonLink href={actionHref} className="mt-6">
        {actionLabel}
      </ButtonLink>
    </section>
  );
}
