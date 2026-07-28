import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { PrivacyLabel } from "@/components/ui/privacy-label";
import { StatusBadge } from "@/components/ui/status-badge";
import { modes } from "@/lib/content";

export default function CreatePage() {
  return (
    <AppShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Create"
          title="Choose how your group wants to plan"
          description="Start with the workflow that matches the decision your group needs to make. Creation forms and live submissions will be added after the foundation phase."
        />

        <div className="grid gap-5 md:grid-cols-2">
          {modes.map((mode) => (
            <Card key={mode.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-teal-700">
                    {mode.eyebrow}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                    {mode.createName}
                  </h2>
                </div>
                <StatusBadge tone="info">Available</StatusBadge>
              </div>
              <p className="mt-4 flex-1 text-sm leading-6 text-slate-600">
                {mode.purpose}
              </p>
              <div className="mt-6">
                <ButtonLink href={mode.href}>{mode.actionLabel}</ButtonLink>
              </div>
            </Card>
          ))}
        </div>

        <PrivacyLabel>
          This screen chooses a planning path only. It does not create wallet
          requests, transactions, or private submissions yet.
        </PrivacyLabel>
      </div>
    </AppShell>
  );
}
