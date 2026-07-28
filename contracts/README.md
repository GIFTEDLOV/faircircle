# FairCircle Contracts

This workspace proves the local iExec Nox toolchain before FairCircle business contracts are added.

## Stack

- Hardhat 3
- TypeScript
- Viem
- Solidity 0.8.35
- `@iexec-nox/nox-hardhat-plugin`
- `@iexec-nox/nox-protocol-contracts`
- `@iexec-nox/nox-confidential-contracts`

The Hardhat configuration follows the official `@iexec-nox/nox-hardhat-plugin` README: it enables `@nomicfoundation/hardhat-toolbox-viem`, enables the Nox plugin, and uses an EDR simulated OP network with unlimited contract size for local Nox testing.

## Commands

From the repository root:

```bash
pnpm install
pnpm compile:contracts
pnpm test:contracts
```

From this package:

```bash
pnpm compile
pnpm test
pnpm deploy:piggy-bank
```

## Smoke Scope

`ConfidentialPiggyBank` is not a FairCircle business contract. It is a local toolchain smoke contract that exercises:

- encrypted initial balance setup;
- encrypted deposits;
- encrypted withdrawals;
- encrypted balance handles;
- owner-only access;
- owner and contract ACL restoration after encrypted operations.

No real private key is required for local compile or test. Copy `.env.example` to `.env` only when a future manual deployment task needs environment-specific values, and never commit secrets.
