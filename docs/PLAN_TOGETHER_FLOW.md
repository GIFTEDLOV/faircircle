# Plan Together Flow

Plan Together coordinates existing FairCircle rooms without moving private values into a new contract.

## Lifecycle

1. The organizer creates a QuietBudget room with `RoomMode.PlanTogether`.
2. Members submit encrypted capacities.
3. Public affordability proofs finalize the budget room.
4. The organizer creates a coordinator plan from the budget room.
5. The organizer permanently selects one finalized affordable public option.
6. The organizer creates a FairSplit room with the same ordered members, same intended split method, and the exact selected cost.
7. The coordinator links the FairSplit room after validating mode, organizer, member order, method, and cost.
8. Anyone confirms the split after shares are ready. Capacity-weighted splits must also have finalized public feasibility equal to true.
9. The organizer creates an invite-only Private Circle with the same ordered members, approved confidential token, intended recipient, and public target equal to the selected cost.
10. The coordinator links the Private Circle room after validating token, recipient, target, access mode, organizer, and member order.
11. Members contribute confidential tokens through Private Circle.
12. Private Circle finalizes contribution positivity proofs, target status, close, withdrawal request, and withdrawal proof.
13. Anyone completes the coordinator plan after Private Circle reports `Withdrawn`.

## Frontend Abstraction

The user experience should present this as one guided Plan Together workflow, but the chain sequence remains multiple transactions across the core and coordinator contracts. The frontend should surface plain states such as budget, split, collection, and complete without exposing encrypted handle or proof terminology to users.

## Cancellation

`cancelPlan` updates only coordinator state and is allowed before a Private Circle room is linked. It does not cancel any child room. Child-room cancellation remains a separate organizer action through `FairCircle.sol`.

## Privacy Boundary

The coordinator reads only public coordination data. It never reads encrypted capacity, share, aggregate, contribution, withdrawal, or token balance handles. Public metadata remains visible: addresses, room IDs, selected option index, selected cost, lifecycle stage, and transaction timing.
