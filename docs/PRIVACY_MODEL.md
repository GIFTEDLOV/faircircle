# FairCircle Privacy Model

## What Is Public

QuietBudget publicly reveals:

- room title;
- organizer address;
- member addresses;
- option costs;
- submission deadline;
- whether each member has submitted;
- when encrypted affordability results are ready;
- finalized affordability booleans for the fixed options.

This is confidentiality for submitted amounts, not wallet anonymity. Addresses and participation metadata are public on-chain.

## What Is Encrypted

Individual member capacity is submitted as `externalEuint256`.

- The contract validates the input proof.
- The contract stores the capacity as an encrypted handle.
- The contract restores ACL so the submitting member and the contract can use/decrypt where appropriate.
- The organizer cannot decrypt another member's capacity unless the organizer is also that submitting member.

Aggregate capacity is encrypted.

- It is updated with `Nox.add`.
- ACL is restored only for the contract.
- Organizer, members, and outsiders are not granted aggregate decryption permissions.

Affordability results are encrypted first.

- The contract computes `Nox.ge(encryptedTotal, encryptedOptionCost)`.
- The result is stored as encrypted `ebool`.
- The contract is granted access.
- The result is marked publicly decryptable.
- The plaintext boolean is stored only after `Nox.publicDecrypt` validates a public-decryption proof.

## Public-Decryption Proof Flow

1. The final member submits a private capacity.
2. The contract evaluates each fixed option into an encrypted `ebool`.
3. Each result handle is marked publicly decryptable.
4. Anyone can ask the Nox gateway for a public-decryption proof for that handle.
5. Anyone can submit that proof to `finalizeAffordability`.
6. The contract validates the proof and stores the public boolean.
7. The room becomes finalized only after every option result is finalized.

## Probing Protection

Options are fixed when the room is created and cannot be changed later. This prevents an organizer from repeatedly adding new thresholds after seeing earlier answers.

The result still leaks bounded information: each public affordability boolean reveals whether the encrypted aggregate is at least a specific fixed option cost. With up to four options, observers learn a bounded range for aggregate capacity, not the exact member capacities.

## Known Metadata Leakage

The chain still exposes:

- room creation time;
- organizer and member addresses;
- option prices;
- deadline;
- submission timing;
- which members submitted;
- final affordability booleans.

FairCircle does not hide wallet identity, network activity, or group membership in this phase.

## FairSplit Privacy

### Equal Split

Equal split keeps assigned share handles access-controlled, but the share values are inferable from public data:

- total cost is public;
- member count is public;
- member order is public;
- rounding policy is public.

Therefore equal split provides handle-level access control and consistent contract behavior, not meaningful monetary secrecy for the share amounts.

### Capacity-Weighted Split

Capacity-weighted split protects private capacity inputs and assigned shares.

Individual capacity:

- submitted as `externalEuint256`;
- usable by the contract;
- decryptable by the submitting member;
- not decryptable by the organizer unless the organizer is that member.

Aggregate capacity:

- encrypted;
- contract-only ACL;
- not decryptable by organizer, members, or outsiders.

Feasibility:

- encrypted result from `Nox.ge(aggregateCapacity, encryptedTotalCost)`;
- marked publicly decryptable;
- plaintext stored only after a valid public-decryption proof.

Assigned share:

- encrypted;
- contract plus assigned-member ACL;
- not decryptable by other members, outsiders, or organizer unless they are the assigned member.

The public feasibility boolean leaks whether the aggregate private capacity can cover the public total cost. Final shares reveal each member's assigned amount to that member only, but member addresses and timing remain public.

## FairSplit Proof Flow

1. Members submit encrypted capacities.
2. The last submission triggers encrypted feasibility evaluation.
3. A Nox public-decryption proof is generated for the feasibility handle.
4. `finalizeSplitFeasibility` validates the proof.
5. If feasible, encrypted proportional shares are calculated and ACLs are restored.
6. If infeasible, shares are not created.

FairSplit can later be reused inside Plan Together after a QuietBudget option has been selected.
