import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PrivacyLabel } from "@/components/ui/privacy-label";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Mode } from "@/lib/content";

type ModePageProps = {
  mode: Mode;
};

export function ModePage({ mode }: ModePageProps) {
  return (
    <AppShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow={mode.eyebrow}
          title={mode.name}
          description={mode.purpose}
          actions={<ButtonLink href="/create">{mode.actionLabel}</ButtonLink>}
        />

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <EmptyState
              title={mode.emptyTitle}
              description={mode.emptyDescription}
              actionLabel={mode.actionLabel}
              actionHref="/create"
            />
          </div>

          <aside className="space-y-4">
            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-950">
                  Mode status
                </h2>
                <StatusBadge tone="info">Foundation</StatusBadge>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                This workspace is ready for product flow design. Live private
                submissions and transactions are not connected in this phase.
              </p>
            </Card>
            <PrivacyLabel>{mode.privacy}</PrivacyLabel>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
