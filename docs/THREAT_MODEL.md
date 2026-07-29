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
