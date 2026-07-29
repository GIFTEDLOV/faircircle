# ADR-001: Modular Plan Together Coordinator

## Status

Accepted.

## Context

After Phase 3, `FairCircle.sol` measured 22,612 bytes of deployed runtime bytecode. The EIP-170 contract size limit is 24,576 bytes, leaving 1,964 bytes of headroom.

QuietBudget, FairSplit, and Private Circle are already implemented in the core contract. Adding Plan Together business logic to that monolith would leave too little room for production hardening and future fixes.

## Decision

Plan Together is implemented as `FairCirclePlanTogether`, a singleton coordinator contract. It links independently created child rooms in `FairCircle.sol`:

1. a PlanTogether QuietBudget room;
2. an affordable selected option;
3. a FairSplit room for the selected public cost;
4. an invite-only Private Circle room for the same public cost;
5. a completed collection after Private Circle withdrawal.

The coordinator validates public state from the core contract only. It does not custody tokens, duplicate Nox computations, store encrypted values, call private-value getters, or become organizer of child rooms.

## Consequences

- `FairCircle.sol` remains frozen for existing mode behavior.
- Each deployable contract is checked independently against EIP-170.
- Users remain organizers of all child rooms.
- The future frontend must abstract multiple transactions into one guided flow.
- Cancellation in the coordinator does not cascade to child rooms; organizers must cancel child rooms separately where the core permits it.

## Security Invariants

- Child rooms can be linked to only one plan.
- The same room cannot be reused in a different Plan Together stage.
- Budget, split, and collection rooms must have the same organizer.
- Split and collection member lists must exactly match the copied budget member order.
- The selected option cost must equal the FairSplit total cost and Private Circle public target.
- The Private Circle recipient must equal the intended recipient.
- Collections must be invite-only and use the approved confidential token.
- Coordinator events expose public metadata only.

## Remaining Limitations

Plan Together does not hide organizer, member addresses, room IDs, option costs, selected option index, selected public cost, lifecycle stage, or transaction timing. It coordinates already-public room state and intentionally leaves confidential balances, capacities, shares, and contributions inside the existing Nox-backed core flows.
