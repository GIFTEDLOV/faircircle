# Live Network Verification

Local tests prove contract behavior against the local Nox stack. Sepolia verification proves that the deployed addresses, bytecode, constructor wiring, and selected bounded workflows work against live Ethereum Sepolia and live Nox infrastructure.

## Commands

```bash
pnpm preflight:sepolia
pnpm deploy:sepolia
pnpm verify:sepolia
pnpm smoke:sepolia
pnpm live-e2e:sepolia
```

Run `smoke:sepolia` only after a deployment manifest exists and Nox live endpoints are configured.

## Safe Smoke Test

`pnpm smoke:sepolia` performs bounded testnet operations:

- reads deployed contract metadata;
- mints a small `tFUSD` amount to the deployer;
- approves and wraps it into `cFUSD`;
- confirms a confidential balance handle exists;
- decrypts the deployer's own confidential balance through the configured Nox handle gateway and subgraph;
- creates a minimal QuietBudget room with the deployer and one distinct actor address;
- submits one encrypted budget input from the deployer;
- confirms transaction receipts and application events.

The smoke script requires `NOX_HANDLE_GATEWAY_URL`, `NOX_SUBGRAPH_URL`, and at least one distinct actor private key from the live E2E actor variables. It refuses to invent a second participant.

## Full Multi-Wallet E2E

`pnpm live-e2e:sepolia` executes the complete Plan Together flow only when all actor credentials and endpoints are available. The minimum setup is four distinct wallets total: deployer, actor 1, actor 2, and actor 3. Actor 3 is also the collection recipient unless `SEPOLIA_RECIPIENT_PRIVATE_KEY` is set for a fifth dedicated recipient wallet.

- deployer organizes the plan and mints test tokens;
- three actor wallets submit private budget capacities;
- the coordinator selects an affordable option;
- actors complete a capacity-weighted FairSplit;
- actors contribute exact confidential shares into an invite-only Private Circle;
- the collection withdraws to actor 3 or the dedicated recipient;
- the coordinator completes the plan;
- the recipient unwraps the exact selected amount to public `tFUSD`.

The script refuses to use the deployer as every member. It checks the deployer and actors are mutually distinct, permits the recipient to equal actor 3 intentionally, deduplicates ETH balance checks for repeated recipient/actor wallets, and verifies live Nox endpoints are configured before broadcasting.

The result file records `recipientMode`:

- `actor3`: `SEPOLIA_RECIPIENT_PRIVATE_KEY` was absent and actor 3 was used as recipient.
- `dedicated`: `SEPOLIA_RECIPIENT_PRIVATE_KEY` was set.

Results are written to:

```text
deployments/ethereum-sepolia-live-e2e.json
```

When prerequisites are absent, the result file records `status: "blocked"` and the exact blocker. It does not fabricate addresses, transaction hashes, or success.

## Confidentiality Checks

The full E2E checks live ACL state:

- deployer cannot read an actor's budget capacity;
- actor can read their own share;
- deployer cannot read an actor's contribution receipt;
- coordinator has no `cFUSD` transfer events in the flow.

These are live-network checks, not wallet anonymity guarantees. Addresses, room IDs, selected public cost, timing, and transaction senders remain public on Sepolia.

## Known Sepolia Limitations

- Sepolia ETH and FairCircle test tokens have no production value.
- RPC providers may rate-limit deployment, source verification, or log lookups.
- Nox live endpoint availability is external to this repository.
- Etherscan source verification is optional and depends on `ETHERSCAN_API_KEY`.
- Live E2E should use disposable test wallets funded only for bounded testnet operations.
