# FairCircle

Private group budgeting, fair cost splitting, and confidential collections powered by iExec Nox.

## Workspaces

- `frontend/`: Next.js frontend scaffold. No wallet integration yet.
- `contracts/`: Hardhat 3, Viem, Solidity, and Nox contract workspace.
- `docs/`: architecture, privacy, deployment, and live-verification notes.
- `deployments/`: sanitized deployment manifests and examples.

## Local Verification

```bash
pnpm install
pnpm compile:contracts
pnpm test:contracts
pnpm check:size
pnpm demo:quiet-budget
pnpm demo:fair-split
pnpm demo:private-circle
pnpm demo:plan-together
pnpm lint:frontend
pnpm build:frontend
pnpm verify
```

## Sepolia Deployment

Copy `.env.example` to either root `.env` or `contracts/.env` and fill local secrets. Never commit real private keys.

```bash
pnpm preflight:sepolia
pnpm deploy:sepolia
pnpm verify:sepolia
pnpm smoke:sepolia
pnpm live-e2e:sepolia
```

Read [docs/SEPOLIA_DEPLOYMENT.md](docs/SEPOLIA_DEPLOYMENT.md) and [docs/LIVE_NETWORK_VERIFICATION.md](docs/LIVE_NETWORK_VERIFICATION.md) before broadcasting. `tFUSD` and `cFUSD` are Sepolia test tokens only.
