# Five-Day Build Plan

## Day 1: Product Foundation

- Establish the product spec and architecture notes.
- Build the landing page, app shell, navigation, and mode routes.
- Add reusable UI primitives.
- Keep all data states empty until real storage and computation exist.

## Day 2: Draft Flow UX

- Add form screens for creating QuietBudget, FairSplit, Private Circle, and Plan Together drafts.
- Define TypeScript domain types.
- Add client-side validation and accessible form states.
- Store draft-only data locally or behind a clearly marked temporary boundary if persistence is not ready.

## Day 3: Privacy Computation Design

- Define the Nox computation inputs and outputs for each mode.
- Map technical states to plain-language product statuses.
- Add developer-only integration notes.
- Keep the UI free of low-level privacy terminology.

## Day 4: Sepolia Integration Preparation

- Add wallet and network planning documentation.
- Define smart-contract interfaces and deployment expectations.
- Create integration service boundaries without exposing fake transaction actions.
- Add test fixtures that do not resemble real user financial data.

## Day 5: End-To-End Prototype

- Connect one narrow happy path after dependencies are approved.
- Add loading, failure, retry, and permission states.
- Run lint, build, and focused tests.
- Prepare a release checklist covering privacy, accessibility, responsive layout, and transaction safety.

## Quality Gates

- No fake balances, fake users, or fake transaction history.
- Lint and production build pass.
- Routes work on mobile and desktop.
- UI copy explains privacy in plain language.
- Technical implementation details stay out of ordinary user flows.
