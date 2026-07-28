# FairCircle Architecture

## Current State

FairCircle currently uses a single Next.js application in `frontend/`.

- Framework: Next.js App Router
- Language: TypeScript
- Styling: Tailwind CSS
- Package manager: pnpm
- Runtime integrations: none yet

The app is frontend-only in this phase. It presents routes, product structure, and empty states without pretending that live group, balance, transaction, wallet, or computation data exists.

Contracts now live in `contracts/` as a separate pnpm workspace package. The frontend remains frozen as scaffold while functional contract work proceeds.

## Directory Shape

```text
frontend/
  public/
    faircircle-hero.png
  src/
    app/
      page.tsx
      app/page.tsx
      create/page.tsx
      quiet-budget/page.tsx
      fair-split/page.tsx
      private-circle/page.tsx
      plan-together/page.tsx
    components/
      app-shell.tsx
      mode-page.tsx
      page-header.tsx
      site-nav.tsx
      ui/
    lib/
      content.ts
      utils.ts
contracts/
  contracts/
    ConfidentialPiggyBank.sol
    FairCircle.sol
  test/
  scripts/
```

## Frontend Architecture

The frontend is organized around shared product metadata and reusable UI components.

- `src/lib/content.ts` is the source of truth for mode names, descriptions, route paths, privacy labels, and empty-state copy.
- `src/components/ui/*` contains small presentational primitives.
- `src/components/site-nav.tsx` provides desktop and mobile navigation.
- `src/components/app-shell.tsx` wraps authenticated-style product pages, although authentication is not implemented yet.
- Mode pages use a shared `ModePage` component so copy and layout stay consistent.

## Future Integration Boundaries

When blockchain work begins, keep integration concerns separate from presentation:

- Wallet and account state should live behind a dedicated provider or service module.
- Nox request construction should live in a technical integration layer, not inside page components.
- Smart-contract calls should be isolated behind typed functions.
- UI pages should consume plain product states such as `draft`, `waiting for members`, `ready`, or `complete`.
- Privacy-sensitive implementation details should not appear in consumer-facing copy.

## Contract Architecture

`ConfidentialPiggyBank.sol` is retained as a local Nox smoke contract. It proves encrypted deposit, withdrawal, balance, decryption, and ACL behavior.

`FairCircle.sol` is the Phase 1 product contract. It implements shared room foundations and QuietBudget:

- rooms use sequential IDs;
- members and options are fixed at creation;
- individual capacity handles are stored per member;
- aggregate capacity is updated with Nox encrypted arithmetic;
- affordability handles are computed with encrypted comparison;
- public affordability is finalized only through Nox public-decryption proofs.

The contract uses bounded loops only over the product limits of 8 members and 4 options.

## Data Model Direction

Expected future domain entities:

- Circle: a private group context.
- Member: a participant in a circle.
- Proposal: a candidate plan or amount to test in QuietBudget.
- Split: an expense allocation configuration.
- Collection: a target-based contribution flow.
- Private submission: a user-owned confidential value submitted for computation.

## Security And Privacy Notes

- Never display individual private budgets, private capacity values, or contribution amounts to other group members.
- Do not log privacy-sensitive values in client code.
- Treat generated result visibility as a product requirement, not a UI afterthought.
- Use plain-language privacy labels in the UI and reserve technical details for developer documentation.
