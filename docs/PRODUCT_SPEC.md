# FairCircle Product Spec

## Summary

FairCircle helps private groups make money decisions without exposing personal financial details. It supports group planning, cost splitting, and collections while keeping individual budgets, capacity, and contribution amounts confidential.

The product is planned for iExec Nox on Ethereum Sepolia. The foundation phase intentionally does not include blockchain, wallet, or Nox package integration.

## Target Users

- Friends planning trips, events, dinners, or shared gifts.
- Families coordinating support, shared bills, or milestone events.
- Small communities collecting money for a common goal.
- Groups where members have different financial comfort levels and need a less awkward way to decide what works.

## Product Principles

- Privacy first: users should understand what remains private without seeing technical privacy vocabulary.
- No invented money data: empty states are preferable to fake balances or fake transactions.
- Plain language: the interface should explain outcomes, actions, and privacy in consumer terms.
- Mobile ready: core flows should work comfortably on phones and desktop.
- Progressive trust: advanced blockchain details can exist in technical surfaces later, not in ordinary group workflows.

## Modes

### QuietBudget

Members privately submit what they can comfortably afford. FairCircle reveals whether proposed plans are affordable for the group without showing individual budgets.

Core future workflow:

1. Create a private budget room.
2. Add proposed plans or price points.
3. Invite members.
4. Members submit private comfort amounts.
5. The group sees which options work.

### FairSplit

A group divides an expense equally or according to privately submitted financial capacity. Each participant sees only their own calculated share.

Core future workflow:

1. Create a split.
2. Choose equal split or private-capacity split.
3. Invite participants.
4. Participants submit private capacity if needed.
5. Each participant receives only their own share.

### Private Circle

A group collects contributions while individual contribution amounts remain confidential. Public status may show contributor count and whether the target has been reached.

Core future workflow:

1. Create a collection.
2. Set a target and deadline.
3. Invite contributors.
4. Contributors privately pledge or contribute.
5. The group sees progress without seeing individual amounts.

### Plan Together

An integrated flow that combines QuietBudget, FairSplit, and Private Circle.

Core future workflow:

1. Agree on an affordable plan.
2. Calculate private-aware shares.
3. Open a private collection for the final amount.
4. Track public progress at group level.

## Current Foundation Scope

- Brand and landing page.
- Application shell and navigation.
- Route structure for all four modes.
- Create flow chooser.
- Reusable UI primitives for buttons, cards, badges, privacy labels, empty states, and page headers.
- Documentation for future implementation.

## Out of Scope For This Phase

- Wallet connection.
- Smart contracts.
- iExec Nox tasks.
- Encrypted computation plumbing.
- Real transactions.
- Backend persistence.
- Authentication.
