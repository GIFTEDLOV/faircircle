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
pnpm check:size
pnpm preflight:sepolia
```

From this package:

```bash
pnpm compile
pnpm test
pnpm check:size
pnpm deploy:piggy-bank
pnpm preflight:sepolia
pnpm deploy:sepolia
pnpm verify:sepolia
pnpm smoke:sepolia
pnpm live-e2e:sepolia
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

`FairCircle` implements shared room foundations, QuietBudget, FairSplit, and Private Circle.

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

Private Circle uses an ERC-7984 confidential token collection flow. Contributions arrive through `confidentialTransferAndCall`, accepted contributions update encrypted individual receipts, cumulative contribution totals, and the encrypted collection aggregate, and withdrawal transfers the encrypted aggregate to the configured recipient after proof validation.

Run the local Private Circle demo:

```bash
pnpm demo:private-circle
```

The demo deploys `TestUSD`, `FairCircleUSD`, and `FairCircle`, wraps tFUSD into cFUSD, submits three confidential contributions, finalizes positivity and target proofs, withdraws to the recipient, and unwraps the exact cFUSD amount back to public tFUSD.

### `FairCirclePlanTogether`

`FairCirclePlanTogether` is a singleton coordinator for Plan Together. It links independently created core rooms and intentionally keeps Plan Together business logic out of `FairCircle.sol`.

The monolith was frozen because Phase 3 measured `FairCircle.sol` at 22,612 bytes of deployed runtime bytecode, leaving 1,964 bytes of EIP-170 headroom. The coordinator architecture keeps each deployable contract under the per-contract EIP-170 limit.

Coordinator guarantees:

- child rooms cannot be reused across plans or stages;
- organizer identity is preserved across budget, split, and collection rooms;
- split and collection members must exactly match the copied budget member order;
- selected public cost must equal split total cost and Private Circle public target;
- collection must be invite-only, use the approved cFUSD token, and pay the intended recipient;
- the coordinator never custodies tokens or encrypted balances.

Run the local Plan Together demo:

```bash
pnpm demo:plan-together
```

The demo executes a complete real flow from PlanTogether QuietBudget through capacity-weighted FairSplit, invite-only Private Circle collection, withdrawal, coordinator completion, and recipient unwrap to public tFUSD.

## Ethereum Sepolia Deployment

Phase 5 deployment tooling targets Ethereum Sepolia (`11155111`) and deploys:

1. `TestUSD`
2. `FairCircleUSD(TestUSD)`
3. `FairCircle`
4. `FairCirclePlanTogether(FairCircle, FairCircleUSD)`

Required local variables are `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY`. Optional `ETHERSCAN_API_KEY` enables source verification. Live Nox checks require `NOX_HANDLE_GATEWAY_URL` and `NOX_SUBGRAPH_URL`. The full live E2E needs deployer plus three distinct actor wallets; actor 3 is the recipient unless optional `SEPOLIA_RECIPIENT_PRIVATE_KEY` provides a fifth wallet.

Private keys must stay in root `.env` or `contracts/.env`, both ignored by git. The scripts print public addresses only.

Use:

```bash
pnpm preflight:sepolia
pnpm deploy:sepolia
pnpm verify:sepolia
pnpm smoke:sepolia
```

The real deployment manifest is written to `deployments/ethereum-sepolia.json`. Existing manifests require `pnpm deploy:sepolia -- --force` to archive and replace. See `docs/SEPOLIA_DEPLOYMENT.md` and `docs/LIVE_NETWORK_VERIFICATION.md`.

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

Plan Together reveals public coordination metadata: plan IDs, child room IDs, selected option index, selected public cost, recipient, lifecycle stage, and transaction timing. It does not expose encrypted handles or private values.

`FairCircle.MAX_SUPPORTED_AMOUNT` is `1e36` token base units. Public total costs are validated against this limit. Encrypted capacity plaintext cannot be range-checked on-chain without additional private range-proof logic, so clients must enforce the same amount policy before encryption until that support exists.

No real private key is required for local compile or test. Copy `.env.example` to `.env` only when a future manual deployment task needs environment-specific values, and never commit secrets.
