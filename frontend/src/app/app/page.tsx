import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PrivacyLabel } from "@/components/ui/privacy-label";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeploymentHealth } from "@/components/web3/deployment-health";
import { modes } from "@/lib/content";

export default function WorkspacePage() {
  return (
    <AppShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Workspace"
          title="Your private planning hub"
          description="Connect a wallet, inspect the live Sepolia deployment, and choose the private workflow your group needs. Interactive submissions are being activated progressively."
          actions={<ButtonLink href="/create">Create new</ButtonLink>}
        />

        <DeploymentHealth />

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {modes.map((mode) => (
            <Card key={mode.id}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-950">
                  {mode.name}
                </h2>
                <StatusBadge tone="success">Sepolia</StatusBadge>
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
          description="No wallet-specific rooms or plans are shown until live workflow reads are added. FairCircle does not fabricate balances, members, or transaction history."
          actionLabel="Create your first plan"
          actionHref="/create"
        />

        <PrivacyLabel>
          Public deployment checks use live contract reads only. Private values
          remain outside the UI unless an authorized wallet later decrypts its
          own data.
        </PrivacyLabel>
      </div>
    </AppShell>
  );
}
