# FairCircle Threat Model

## Protected Assets

- Private member capacities in QuietBudget and capacity-weighted FairSplit.
- Private assigned shares in FairSplit.
- Private contribution receipts, cumulative contributions, collection aggregate, and withdrawal amount in Private Circle.
- Plan Together lifecycle integrity across linked child rooms.

## Trusted Components

- iExec Nox contracts and local Nox compute stack for encrypted arithmetic, ACLs, and public-decryption proofs.
- ERC-7984 confidential token implementation that reports interface support through ERC-165.

## Phase 4 Coordinator Threats And Mitigations

### Child-room reuse

Risk: a room could be attached to multiple plans or to multiple stages in the same plan.

Mitigation: `FairCirclePlanTogether` stores `linkedPlanForRoom` and rejects every already-linked room.

### Organizer mismatch

Risk: a coordinator plan could link child rooms controlled by a different organizer.

Mitigation: every linked child room must report the same organizer copied from the budget room.

### Member-list mismatch

Risk: split or collection participants could differ from the budget participants.

Mitigation: the coordinator compares the exact ordered member list copied from the budget room. Missing, extra, different, and reordered members are rejected.

### Cost and target mismatch

Risk: selected affordability, split allocation, and collection target could refer to different public amounts.

Mitigation: the selected option cost must equal the FairSplit total cost and Private Circle public target.

### Token custody

Risk: the coordinator could become a token custodian or approval target.

Mitigation: the coordinator has no token transfer functions, performs no token custody, and only validates the approved confidential token address on collection linking.

### Stage skipping

Risk: plans could advance without finalized affordability, ready shares, linked collections, or completed withdrawals.

Mitigation: each transition checks the current stage and required public child-room state.

### Privacy leakage

Risk: a coordination layer could expose encrypted handles or inferred private values.

Mitigation: `IFairCircleCore` omits private-value getters, coordinator getters expose public coordination state only, and coordinator events emit metadata only.

## Remaining Metadata Leakage

FairCircle does not provide wallet anonymity. Observers can see organizers, members, room IDs, option costs, selected public cost, recipient address, lifecycle timing, and transaction senders. Public feasibility and affordability booleans intentionally reveal bounded aggregate results.

## Phase 5 Deployment Threats And Mitigations

### Wrong network deployment

Risk: contracts could be deployed to a chain that is not Ethereum Sepolia.

Mitigation: preflight and deployment scripts require live chain ID `11155111` and fail on any mismatch.

### Missing Nox infrastructure

Risk: product contracts could deploy to Sepolia while the configured Nox compute address is absent.

Mitigation: preflight and deployment check runtime bytecode at the installed package's expected Nox compute address before broadcasting FairCircle deployments.

### Secret leakage

Risk: deployer or actor private keys could leak through logs, manifests, committed files, or raw RPC traces.

Mitigation: scripts read secrets only from ignored `.env` files, print public addresses only, never serialize private keys, and `.gitignore` excludes env files, key files, actor-wallet files, temporary deployment files, and raw RPC logs containing sensitive headers.

### Manifest tampering or drift

Risk: recorded deployment evidence could disagree with live chain state.

Mitigation: `verify-sepolia-deployment.ts` checks chain ID, non-zero distinct addresses, live bytecode hashes, deployment receipts, deployment blocks, constructor wiring, initial counters/constants, and manifest git SHA.

### Accidental manifest overwrite

Risk: a new deployment could silently replace previous evidence.

Mitigation: deployment writes atomically and refuses to overwrite `deployments/ethereum-sepolia.json` unless `--force` is supplied. Forced replacement archives the old manifest first.

### Unsafe live E2E shortcuts

Risk: one wallet could be reused to simulate multiple members, invalidating privacy and participant checks.

Mitigation: the live E2E script requires dedicated actor private keys, checks distinct public addresses, checks actor ETH balances, and records blockers instead of fabricating success when prerequisites are unavailable.
