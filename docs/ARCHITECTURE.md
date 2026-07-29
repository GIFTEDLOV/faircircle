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
    FairCirclePlanTogether.sol
    FairCircleUSD.sol
    TestUSD.sol
    interfaces/
      IFairCircleCore.sol
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

`FairCircle.sol` is the core product contract. It implements shared room foundations, QuietBudget, FairSplit, and Private Circle:

- rooms use sequential IDs;
- members and options are fixed at creation;
- individual capacity handles are stored per member;
- aggregate capacity is updated with Nox encrypted arithmetic;
- affordability handles are computed with encrypted comparison;
- public affordability is finalized only through Nox public-decryption proofs.
- equal-split shares are calculated immediately from public total/member count and stored as encrypted handles;
- capacity-weighted split feasibility is publicly proven before encrypted proportional shares are calculated.
- confidential Private Circle contributions are received through ERC-7984 callbacks;
- Private Circle withdrawal is handled by the core contract after proof-validated encrypted settlement.

The contract uses bounded loops only over the product limits of 8 members and 4 options.

FairSplit shares reuse the room member list and per-member encrypted handle mappings. Equal split is finalized immediately. Capacity-weighted split moves from `CollectingInputs` to `ReadyForDecryption` after all capacities are submitted, then to `Finalized` after public feasibility proof validation.

Private Circle stores encrypted contribution receipts, cumulative contribution handles, aggregate collection handles, public target handles, and withdrawal handles. FairCircle events expose contribution and collection metadata but do not emit plaintext contribution, aggregate, or withdrawal amounts.

`FairCirclePlanTogether.sol` is a separate coordinator. It was added because the Phase 3 `FairCircle.sol` runtime measured 22,612 bytes, leaving 1,964 bytes of EIP-170 headroom. The core is therefore frozen for existing business logic and Plan Together links child rooms instead of extending the monolith.

The coordinator:

- reads public state from the exact configured core contract;
- copies the budget room title and ordered member list;
- requires child-room organizer identity to match the plan organizer;
- prevents room reuse across plans and stages;
- requires exact ordered member matching for split and collection rooms;
- requires selected cost, split total, and collection target to match;
- requires invite-only collection access with the approved confidential token;
- does not custody tokens or store encrypted values.

The future frontend should hide the multi-transaction sequence behind one Plan Together workflow while preserving these contract boundaries.

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
