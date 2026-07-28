# FairCircle Contract Spec

## Phase 1 Scope

`FairCircle.sol` currently implements shared room foundations, QuietBudget, FairSplit, and Private Circle. Plan Together orchestration is not implemented yet.

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

`ConfidentialPiggyBank.sol` remains a smoke contract for the Nox toolchain. `FairCircle.sol` is the product contract for the implemented modes.

## FairSplit

FairSplit supports two standalone methods:

- `Equal`: public total cost divided by member count.
- `CapacityWeighted`: private capacities determine proportional shares after public feasibility is proven.

### Equal Split

Public inputs:

- title;
- member addresses;
- total cost;
- submission deadline;
- split method.

The contract calculates:

- `baseShare = totalCost / memberCount`;
- `remainder = totalCost % memberCount`;
- first listed member receives `baseShare + remainder`;
- every other member receives `baseShare`.

Each stored share is an encrypted handle with contract plus assigned-member ACL. Because total cost and member count are public, equal shares are mathematically inferable even though the stored handle is access-controlled.

### Capacity-Weighted Split

Each listed member submits one encrypted capacity before the deadline. The contract updates encrypted aggregate capacity with `Nox.add`.

After the final submission:

1. The contract computes encrypted feasibility with `Nox.ge(aggregateCapacity, encryptedTotalCost)`.
2. The feasibility handle is made publicly decryptable.
3. Anyone may submit a valid public-decryption proof.
4. The contract stores only the verified public feasibility boolean.
5. If infeasible, no shares are created.
6. If feasible, shares are calculated as:

```text
share = capacity * totalCost / aggregateCapacity
```

The integer-division remainder is assigned to the first listed member. Each share handle is restored with contract plus assigned-member ACL.

### Amount Limits

`FairCircle.MAX_SUPPORTED_AMOUNT` is `1e36` token base units. Public total costs must be non-zero and at or below this limit.

Submitted capacities are encrypted, so the contract cannot check their plaintext amount without breaking confidentiality. The limit is documented for clients and future frontends; capacity validation can be enforced before encryption by client-side and server-side policy, and future Nox flows may add private range checks.

## Private Circle

Private Circle supports confidential ERC-7984 token collections. A room can be open to anyone or invite-only with 2 to 8 listed contributors.

Public inputs:

- title;
- confidential token address;
- recipient address;
- optional public target;
- deadline;
- collection access mode;
- invited members for invite-only rooms.

Encrypted state:

- each contribution receipt;
- each contributor's cumulative contribution;
- collection aggregate;
- target-reached handle when a public target is configured;
- withdrawal amount and withdrawal success handle.

### Contribution Flow

Contributors send confidential tokens with `confidentialTransferAndCall`, passing the room ID as callback data. The callback accepts only the room's configured confidential token, only while the collection is open, only before the deadline, and only from invited members for invite-only rooms.

The contract stores the transferred encrypted amount as a contribution receipt, updates the contributor's cumulative contribution, and updates the encrypted collection aggregate. A public-decryptable positivity handle is created so anyone can finalize whether the contribution was accepted without revealing the amount.

Public contribution status exposes:

- verified contribution count;
- unique verified contributor count;
- whether an account has a verified contribution.

It does not expose individual contribution amounts or the aggregate plaintext amount.

### Target Status

If a public target is configured, each accepted callback updates an encrypted target comparison:

```text
target reached = collection aggregate >= public target
```

The comparison handle is publicly decryptable. Finalization stores only the public target status and version, so new contributions invalidate the previous finalized target result until the latest version is finalized.

### Withdrawal

The organizer may close a collection, then request withdrawal after at least one positive contribution has been finalized. The contract transfers the encrypted aggregate to the configured recipient and creates a public-decryptable success handle. Finalizing a successful withdrawal marks the collection withdrawn and the room finalized.

The recipient and organizer receive ACL access to the encrypted withdrawal amount. The collection aggregate is reset after successful finalization.

### Cancellation

The organizer may cancel a Private Circle only while it is still open and before any contribution callback has been received. Once a callback arrives, cancellation is blocked so funds must move through close and withdrawal.
