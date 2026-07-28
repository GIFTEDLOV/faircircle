import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PrivacyLabel } from "@/components/ui/privacy-label";
import { StatusBadge } from "@/components/ui/status-badge";
import { modes } from "@/lib/content";

export default function WorkspacePage() {
  return (
    <AppShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Workspace"
          title="Your private planning hub"
          description="Create private budgets, fair splits, confidential collections, or one guided group plan. Live group data will appear here after persistence and integrations are added."
          actions={<ButtonLink href="/create">Create new</ButtonLink>}
        />

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {modes.map((mode) => (
            <Card key={mode.id}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-950">
                  {mode.name}
                </h2>
                <StatusBadge>Ready</StatusBadge>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {mode.summary}
              </p>
              <ButtonLink href={mode.href} variant="ghost" className="mt-5 px-0">
                Open
              </ButtonLink>
            </Card>
          ))}
        </div>

        <EmptyState
          title="No active circles yet"
          description="Your created budgets, splits, collections, and guided plans will appear here once real data storage is implemented."
          actionLabel="Create your first plan"
          actionHref="/create"
        />

        <PrivacyLabel>
          This workspace does not show fabricated balances, transaction history,
          or members. Empty states are intentional until real data exists.
        </PrivacyLabel>
      </div>
    </AppShell>
  );
}
