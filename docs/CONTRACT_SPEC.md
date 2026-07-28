# FairCircle Contract Spec

## Phase 1 Scope

Phase 1 implements `FairCircle.sol` with shared room foundations and the real QuietBudget module only. FairSplit, Private Circle, and Plan Together business logic are not implemented yet.

## QuietBudget Rooms

A QuietBudget room compares fixed public option costs against privately submitted member capacities.

Public room metadata:

- sequential room ID;
- title;
- organizer address;
- room mode;
- room status;
- submission deadline;
- member addresses;
- public option costs;
- submission count;
- finalized option count;
- finalized affordability booleans.

Encrypted state:

- each member's submitted capacity;
- aggregate capacity;
- per-option affordability result handles before finalization.

## Limits

- Members: 2 to 8 unique non-zero addresses.
- Options: 1 to 4 unique non-zero costs.
- Options are fixed at room creation and cannot be changed.
- Submission deadline must be in the future.
- Mode must be `QuietBudget` or `PlanTogether`.

These limits intentionally bound gas, storage loops, and privacy probing.

## Room Status

- `CollectingInputs`: members may submit before the deadline.
- `ReadyForDecryption`: all members submitted and encrypted affordability handles were computed.
- `Finalized`: every option result was finalized through a valid public-decryption proof.
- `Cancelled`: organizer cancelled before encrypted evaluation began.

## Main Functions

- `createQuietBudgetRoom(...)`: creates a room with fixed members, fixed options, deadline, and mode.
- `submitPrivateCapacity(...)`: accepts an `externalEuint256` and proof from a listed member.
- `finalizeAffordability(...)`: verifies a Nox public-decryption proof and stores the public boolean.
- `cancelRoom(...)`: organizer-only cancellation before evaluation.
- Getter functions expose room metadata, member lists, options, handles, membership, submission state, and public affordability state.

## Events

Events expose only safe public metadata:

- `RoomCreated`
- `CapacitySubmitted`
- `AffordabilityReady`
- `AffordabilityFinalized`
- `RoomFinalized`
- `RoomCancelled`

No event emits individual capacity plaintext or aggregate capacity plaintext.

## Verification Target

`ConfidentialPiggyBank.sol` remains a smoke contract for the Nox toolchain. `FairCircle.sol` is the Phase 1 product contract.
