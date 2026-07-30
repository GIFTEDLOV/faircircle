import Link from "next/link";
import { ButtonLink } from "@/components/ui/button-link";
import { WalletControl } from "@/components/web3/wallet-control";
import { primaryNavItems } from "@/lib/content";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <nav
        className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8"
        aria-label="Main navigation"
      >
        <Link href="/" className="flex items-center gap-3 font-semibold">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-md bg-slate-950 text-sm text-white"
          >
            FC
          </span>
          <span className="text-slate-950">FairCircle</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {primaryNavItems.slice(1).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <WalletControl />
          <ButtonLink href="/create" variant="primary">
            New plan
          </ButtonLink>
        </div>

        <details className="relative md:hidden">
          <summary className="flex min-h-10 cursor-pointer list-none items-center rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-800 marker:hidden">
            Menu
          </summary>
          <div className="absolute right-0 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
            {primaryNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-md px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 border-t border-slate-200 pt-2">
              <WalletControl />
            </div>
          </div>
        </details>
      </nav>
    </header>
  );
}
