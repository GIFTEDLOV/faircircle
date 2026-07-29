# Sepolia Deployment

FairCircle Phase 5 targets Ethereum Sepolia, chain ID `11155111`.

## Required Environment

Store secrets only in root `.env` or `contracts/.env`. Both are ignored by git.

Required for preflight and deployment:

- `SEPOLIA_RPC_URL`: Ethereum Sepolia JSON-RPC URL.
- `DEPLOYER_PRIVATE_KEY`: deployer private key. Never print it or paste it into source code.

Optional:

- `ETHERSCAN_API_KEY`: enables Etherscan source verification.
- `NOX_HANDLE_GATEWAY_URL`: required for live handle encryption/decryption scripts.
- `NOX_SUBGRAPH_URL`: required for live handle encryption/decryption scripts.

Full live E2E additionally requires:

- `SEPOLIA_ACTOR_1_PRIVATE_KEY`
- `SEPOLIA_ACTOR_2_PRIVATE_KEY`
- `SEPOLIA_ACTOR_3_PRIVATE_KEY`
- `SEPOLIA_RECIPIENT_PRIVATE_KEY`

These actor wallets must be distinct and funded with Sepolia ETH.

## Deployment Order

`pnpm deploy:sepolia` deploys exactly:

1. `TestUSD`
2. `FairCircleUSD(TestUSD)`
3. `FairCircle`
4. `FairCirclePlanTogether(FairCircle, FairCircleUSD)`

`FairCircle.sol` is not extended for Plan Together. Plan Together remains in the separate coordinator.

## Preflight

Run:

```bash
pnpm preflight:sepolia
```

Preflight validates:

- required environment variables;
- connected chain ID is `11155111`;
- deployer public address;
- deployer Sepolia ETH balance;
- the expected Nox compute address has runtime bytecode;
- deployment artifacts can be loaded;
- sample deployment gas can be estimated without broadcasting.

If credentials are missing, preflight fails before any transaction is sent and lists the missing variable names.

## Deployment

Run:

```bash
pnpm deploy:sepolia
```

The script compiles through Hardhat before broadcasting, checks gas and balance before each deployment, waits for confirmed receipts, verifies deployed bytecode exists, verifies constructor wiring, and writes:

```text
deployments/ethereum-sepolia.json
```

The manifest is written atomically. Existing manifests are never overwritten silently. To intentionally replace one:

```bash
pnpm deploy:sepolia -- --force
```

The previous manifest is copied to `deployments/archive/`.

## Manifest

Real manifests record:

- network name and chain ID;
- deployer public address;
- git commit SHA;
- contract addresses;
- constructor arguments;
- deployment transaction hashes;
- block numbers;
- gas used;
- timestamp;
- Nox compute address and runtime bytecode hash;
- deployed runtime bytecode hashes;
- source-verification status.

Manifests never contain private keys, RPC headers, bearer tokens, `.env` contents, encrypted plaintexts, or live Nox secrets.

## Post-Deployment Verification

Run:

```bash
pnpm verify:sepolia
```

This independently checks the manifest against live Sepolia state. When `ETHERSCAN_API_KEY` exists, the same command attempts Etherscan source verification for all four contracts with exact constructor arguments and updates only the source-verification section of the manifest.

Absence of `ETHERSCAN_API_KEY` does not invalidate the deployment. Source verification is reported as skipped.

## Test Tokens

`TestUSD` (`tFUSD`) and `FairCircleUSD` (`cFUSD`) are Sepolia test contracts for FairCircle demos and verification only. They are not production USDC or production money.
