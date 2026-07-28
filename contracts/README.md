# FairCircle Contracts

This workspace contains the local iExec Nox contract foundation and FairCircle product contracts.

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

## Contracts

### `ConfidentialPiggyBank`

`ConfidentialPiggyBank` is not a FairCircle business contract. It is a local toolchain smoke contract that exercises:

- encrypted initial balance setup;
- encrypted deposits;
- encrypted withdrawals;
- encrypted balance handles;
- owner-only access;
- owner and contract ACL restoration after encrypted operations.

### `FairCircle`

`FairCircle` currently implements shared room foundations, QuietBudget, and FairSplit.

QuietBudget lets a group compare fixed public option costs against privately submitted encrypted capacities. Individual capacities and aggregate capacity remain encrypted; final public affordability booleans are stored only after valid Nox public-decryption proofs.

Run the local demo:

```bash
pnpm demo:quiet-budget
```

The demo deploys `FairCircle`, creates a three-member QuietBudget room, submits encrypted capacities `40`, `80`, and `100`, finalizes options `150`, `220`, and `250`, and prints `true, true, false`.

FairSplit demos:

```bash
pnpm demo:fair-split
```

The demo creates:

- an equal split with total `100`, producing shares `34`, `33`, `33`;
- a capacity-weighted split with total `300` and private capacities `40`, `80`, `100`, `180`, producing shares `30`, `60`, `75`, `135`.

Both demos prove unauthorized accounts cannot decrypt protected handles.

## Privacy Scope

QuietBudget public data:

- room title, organizer, members, deadline, and option costs;
- submission state;
- final affordability booleans.

QuietBudget encrypted data:

- individual capacities;
- aggregate capacity;
- intermediate affordability handles.

Individual capacities are decryptable only by the submitting member. Aggregate capacity is usable only by the contract. Affordability handles are marked publicly decryptable, but public booleans are finalized only after proof validation.

This is confidentiality, not wallet anonymity: addresses, participation, and timing remain public.

FairSplit equal shares are inferable because total cost, member count, member order, and rounding policy are public. Capacity-weighted split keeps capacities, aggregate capacity, and assigned shares confidential except to authorized accounts.

`FairCircle.MAX_SUPPORTED_AMOUNT` is `1e36` token base units. Public total costs are validated against this limit. Encrypted capacity plaintext cannot be range-checked on-chain without additional private range-proof logic, so clients must enforce the same amount policy before encryption until that support exists.

No real private key is required for local compile or test. Copy `.env.example` to `.env` only when a future manual deployment task needs environment-specific values, and never commit secrets.
