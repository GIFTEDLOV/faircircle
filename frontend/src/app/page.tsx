import Image from "next/image";
import { SiteNav } from "@/components/site-nav";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { PrivacyLabel } from "@/components/ui/privacy-label";
import { StatusBadge } from "@/components/ui/status-badge";
import { modes } from "@/lib/content";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50">
      <SiteNav />
      <main>
        <section className="relative isolate flex min-h-[82svh] items-center overflow-hidden bg-slate-950">
          <Image
            src="/faircircle-hero.png"
            alt="Private group finance workspace with privacy-focused planning cards"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.92)_0%,rgba(15,23,42,0.7)_42%,rgba(15,23,42,0.12)_100%)]" />
          <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <StatusBadge tone="success">Foundation phase</StatusBadge>
              <h1 className="mt-6 text-5xl font-semibold tracking-tight text-white sm:text-6xl">
                FairCircle
              </h1>
              <p className="mt-6 text-xl leading-8 text-slate-100">
                Private group budgeting, fair cost splitting, and confidential
                collections for plans where comfort matters as much as the
                total.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/create">Create a private plan</ButtonLink>
                <ButtonLink href="/app" variant="secondary">
                  Open workspace
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white py-16">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-teal-700">
                Four private planning modes
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Choose the least awkward way to make a group money decision.
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                FairCircle keeps sensitive inputs private while giving the
                group clear next steps. This phase provides the production UI
                foundation before blockchain integrations begin.
              </p>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {modes.map((mode) => (
                <Card key={mode.id} className="flex flex-col">
                  <p className="text-sm font-semibold text-teal-700">
                    {mode.eyebrow}
                  </p>
                  <h3 className="mt-3 text-xl font-semibold text-slate-950">
                    {mode.name}
                  </h3>
                  <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">
                    {mode.summary}
                  </p>
                  <ButtonLink
                    href={mode.href}
                    variant="ghost"
                    className="mt-5 justify-start px-0"
                  >
                    View mode
                  </ButtonLink>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-slate-50 py-16">
          <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[1fr_420px] lg:px-8">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-sky-700">
                Plain-language privacy
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Sensitive amounts stay out of the group chat.
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                The interface is designed around outcomes people can understand:
                what works, what each person owes, and whether the group target
                has been reached. Technical privacy details belong in the
                architecture layer, not in everyday workflows.
              </p>
            </div>
            <PrivacyLabel>
              FairCircle is not connected to wallets, private computation, or
              live transactions in this foundation phase.
            </PrivacyLabel>
          </div>
        </section>
      </main>
    </div>
  );
}
