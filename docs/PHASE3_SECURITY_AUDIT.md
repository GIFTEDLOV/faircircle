# Phase 3 Security Audit

Audit base: `fead653 Implement Phase 3 Private Circle`

Scope: `FairCircle.sol`, `FairCircleUSD.sol`, `TestUSD.sol`, Private Circle tests, Private Circle demo, and deployability tooling. Frontend and Plan Together were out of scope.

## Summary

No Critical or High defects were confirmed during this pass.

Private Circle is deployable under EIP-170, but `FairCircle.sol` is close enough to the runtime bytecode limit that Plan Together should not be added to the same monolithic contract. Future modes should move behind a modular registry/factory or dedicated mode contracts.

## Deployability

Measured with `pnpm check:size`:

- Creation bytecode: 22,648 bytes
- Deployed runtime bytecode: 22,612 bytes
- EIP-170 runtime limit: 24,576 bytes
- Runtime headroom: 1,964 bytes
- Runtime usage: 92.01%
- Deployment gas estimate: 4,987,402

Finding: Medium - limited EIP-170 headroom.

Fix: Added `contracts/scripts/check-contract-size.ts` and root command `pnpm check:size`. The command fails when runtime bytecode exceeds 24,576 bytes and warns when remaining headroom is low.

Remaining limitation: Plan Together should use a modular architecture rather than being added directly to `FairCircle.sol`.

## Findings

### Critical

None.

### High

None.

### Medium

1. Limited monolithic contract headroom.

`FairCircle.sol` is under EIP-170 but only has 1,964 bytes of runtime headroom. That is not enough margin for Plan Together plus future security checks.

Fix: Added a repeatable deployability gate and documented that Plan Together requires modularization.

2. Encrypted zero or failed transfer callbacks cannot be ignored in public state.

The callback receives an encrypted actual transfer amount. The contract cannot branch public storage writes on whether that encrypted amount is positive without revealing private information. A zero or failed transfer therefore creates a pending contribution that later finalizes as rejected.

Fix: Added focused tests proving rejected contributions do not increase verified counts, do not alter aggregate value, and cannot enable withdrawal.

Remaining limitation: Any callback, including an encrypted zero callback, blocks organizer cancellation. This is conservative because the contract cannot safely distinguish zero from positive at callback time.

### Low

1. Direct confidential token transfers bypass room accounting.

Users can send cFUSD directly to the contract without `confidentialTransferAndCall`. Those balances are not assigned to any room and cannot be withdrawn through Private Circle accounting.

Fix: Added regression coverage proving direct transfers do not create contribution records or alter room aggregate accounting.

Remaining limitation: Users must use the callback flow. The frontend should never expose direct transfer to the FairCircle address.

2. Room security assumes the configured token is compliant.

The contract verifies that the token address is code and claims IERC7984 support through ERC-165. A malicious contract can still claim support while violating token accounting semantics.

Fix: Added tests for EOA rejection, non-IERC7984 rejection, wrong-token callback rejection, and actual transferred amount accounting.

Remaining limitation: Production deployments should use an allowlist or registry of approved confidential token wrappers.

3. Encrypted handle getters expose opaque handles to callers.

Several public view functions return encrypted handles. ACLs prevent unauthorized decryption, but handle identifiers are still observable.

Fix: Added tests proving unauthorized users cannot decrypt contribution receipts or aggregates, and FairCircle events do not emit sensitive encrypted handles.

Remaining limitation: Handle getters are useful for proof generation and local tests. Frontends should treat them as low-level contract APIs, not user-facing concepts.

### Informational

1. Event privacy verified.

FairCircle application events for contribution, target finalization, and withdrawal do not emit plaintext contribution amounts, aggregate amounts, withdrawal amounts, contribution receipt handles, aggregate handles, or withdrawal amount handles. ERC-7984 token events may emit encrypted transfer handles; tests distinguish token events from FairCircle application events.

2. Checks-effects-interactions reviewed.

`requestCollectionWithdrawal` sets `withdrawalRequested`, `collectionStatus`, and room status before calling `confidentialTransfer`, and it uses the non-reentrant modifier. `finalizeCollectionWithdrawal` validates the proof before final state transition and zeroes the aggregate after successful finalization.

3. Replay protections reviewed.

Contribution finalization rejects repeated finalization. Target finalization rejects repeated finalization for the current version and rejects older handle proofs after a new contribution creates a new version. Withdrawal finalization rejects repeated finalization and second withdrawal attempts.

4. ACL restoration reviewed.

Coverage now checks ACL restoration for contribution receipts, cumulative contributions, collection aggregate, target/public decrypt handles, withdrawal proof handles, and wrapper balances.

## Verification Coverage Added

The Private Circle suite now covers:

- TestUSD metadata, minting, cFUSD wrapping, confidential balances, confidential transfer, unwrap request/finalization, invalid unwrap proof, and repeat unwrap rejection.
- Open and invite-only room creation plus invalid token, recipient, deadline, invitee, and target inputs.
- Callback sender, token, data, room, mode, lifecycle, deadline, invite-only, open access, actual transfer amount, ACL, and direct-transfer bypass behavior.
- Positive, zero, failed, repeated, cumulative, aggregate, receipt, and ACL contribution behavior.
- Valid, invalid, wrong-handle, repeated, rejected, verified count, unique count, and repeated-wallet contribution finalization.
- Below, exact, above, no-target, invalid proof, old-handle replay, repeated finalization, new-version, and aggregate non-disclosure target behavior.
- Cancellation, close, deadline withdrawal, zero verified contribution, organizer/outsider authorization, duplicate withdrawal, withdrawal proof validation, replay prevention, aggregate reset, and recipient unwrap.
- FairCircle event privacy and ERC-7984 event separation.

## Regression Scope

PiggyBank, QuietBudget, and FairSplit remain covered by the existing full contract test suite.
