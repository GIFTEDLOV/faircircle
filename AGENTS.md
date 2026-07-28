# FairCircle Agent Guide

FairCircle is a production-quality private group-finance application powered by iExec Nox on Ethereum Sepolia. The current phase is frontend foundation only.

## Working Rules

- Use the existing Next.js app in `frontend/`.
- Do not create another app or Git repository.
- Do not install blockchain, wallet, or Nox packages until that phase is requested.
- Do not add fake transaction behavior, fabricated balances, or invented users.
- Keep ordinary interface copy in plain language. Do not expose implementation terms such as encrypted integer types, handles, proofs, or access-control internals to users.
- Preserve strict TypeScript and keep components modular.
- Do not commit changes unless the user explicitly asks.

## Commands

Run commands from `frontend/`:

```bash
pnpm lint
pnpm build
```

## Product Modes

- QuietBudget: members privately submit what they can afford; the group sees which plans are affordable.
- FairSplit: divides an expense equally or according to private capacity; each participant sees only their own share.
- Private Circle: collects contributions while keeping individual amounts confidential.
- Plan Together: integrated flow from budget agreement to split calculation to collection.
