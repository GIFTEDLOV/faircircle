import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";
import {
  classifyTargetUnwrapState,
  deriveTargetRecoveryContext,
  LIVE_PLAN_TOGETHER_TITLE,
  type CollectionRoomReport,
  type LedgerEntry,
  type PlanReport,
  type RecipientDiagnosisReport,
  type UnwrapEventReport,
  type UnwrapStateReport,
} from "../scripts/recipient-balance-lineage.js";

const deployer = "0x0000000000000000000000000000000000000001" as const satisfies Address;
const recipient = "0x0000000000000000000000000000000000000002" as const satisfies Address;
const withdrawal1 = tx(1);
const withdrawal2 = tx(2);
const completion2 = tx(3);

describe("Sepolia recipient balance lineage recovery", () => {
  it("derives the second completed plan as the diagnosed target", () => {
    const context = deriveContext();

    assert.equal(context.targetPlanId, 2n);
    assert.equal(context.targetCollectionRoomId, 7n);
    assert.equal(context.source, "diagnosis");
  });

  it("derives the 150 baseline from the chronological ledger", () => {
    const context = deriveContext();

    assert.equal(context.preExistingRecipientBalance, 150n);
    assert.equal(context.targetWithdrawalCredit, 150n);
  });

  it("accepts current balance 300 for a 150 target recovery", () => {
    const context = deriveContext();

    assert.equal(context.targetSelectedCost, 150n);
    assert.equal(context.expectedBalanceBeforeUnwrap, 300n);
    assert.equal(context.expectedRemainingConfidentialBalance, 150n);
  });

  it("fresh unwrap recovers only the target amount and leaves the baseline", () => {
    const state = classifyTargetUnwrapState({
      unwrapState: emptyUnwrapState(),
      planCompletedBlock: 20n,
      selectedCost: 150n,
      currentRecipientBalance: 300n,
      preExistingRecipientBalance: 150n,
    });

    assert.equal(state.idempotency, "fresh-unwrap");
    assert.equal(state.expectedRemainingConfidentialBalance, 150n);
  });

  it("pending unwrap expects the baseline as the remaining confidential balance", () => {
    const state = classifyTargetUnwrapState({
      unwrapState: unwrapState({
        pending: [unwrapEvent({ amount: "150", blockNumber: "21" })],
      }),
      planCompletedBlock: 20n,
      selectedCost: 150n,
      currentRecipientBalance: 150n,
      preExistingRecipientBalance: 150n,
    });

    assert.equal(state.idempotency, "pending-unwrap");
    assert.equal(state.expectedRemainingConfidentialBalance, 150n);
  });

  it("finalized unwrap accepts the baseline as the remaining confidential balance", () => {
    const handle = handleHex(1);
    const state = classifyTargetUnwrapState({
      unwrapState: unwrapState({
        all: [unwrapEvent({ amount: "150", handle, blockNumber: "21" })],
        finalized: [unwrapEvent({ amount: "150", handle, blockNumber: "22" })],
      }),
      planCompletedBlock: 20n,
      selectedCost: 150n,
      currentRecipientBalance: 150n,
      preExistingRecipientBalance: 150n,
    });

    assert.equal(state.idempotency, "already-finalized");
    assert.equal(state.expectedRemainingConfidentialBalance, 150n);
  });

  it("rejects an attempted 300 unwrap for the 150 target recovery", () => {
    assert.throws(
      () =>
        classifyTargetUnwrapState({
          unwrapState: unwrapState({
            pending: [unwrapEvent({ amount: "300", blockNumber: "21" })],
          }),
          planCompletedBlock: 20n,
          selectedCost: 150n,
          currentRecipientBalance: 150n,
          preExistingRecipientBalance: 150n,
        }),
      /Unrelated recipient unwrap/,
    );
  });

  it("rejects when ledger-derived and decrypted balances differ", () => {
    assert.throws(
      () => deriveContext({ currentRecipientBalance: 299n }),
      /ledger-derived balance 300 does not match decrypted current balance 299/,
    );
  });

  it("rejects a duplicated target withdrawal", () => {
    assert.throws(
      () =>
        deriveContext({
          ledger: [
            ...baseLedger(),
            ledgerEntry({
              blockNumber: "31",
              transactionHash: withdrawal2,
              relatedPlanId: "2",
              relatedRoomId: "7",
              decryptedAmount: "150",
              resultingBalance: "450",
            }),
          ],
          currentRecipientBalance: 450n,
        }),
      /appears 2 times/,
    );
  });

  it("rejects an ambiguous target plan without diagnosis or explicit target", () => {
    assert.throws(
      () =>
        deriveTargetRecoveryContext({
          plans: basePlans(),
          collections: baseCollections(),
          ledger: baseLedger(),
          currentRecipientBalance: 300n,
          recipient,
        }),
      /cannot be uniquely identified/,
    );
  });

  it("rejects an unrelated recipient unwrap after PlanCompleted", () => {
    assert.throws(
      () =>
        classifyTargetUnwrapState({
          unwrapState: unwrapState({
            pending: [unwrapEvent({ amount: "25", blockNumber: "21" })],
          }),
          planCompletedBlock: 20n,
          selectedCost: 150n,
          currentRecipientBalance: 150n,
          preExistingRecipientBalance: 150n,
        }),
      /Unrelated recipient unwrap/,
    );
  });

  it("correlates the exact target withdrawal transaction", () => {
    const context = deriveContext();

    assert.equal(context.targetWithdrawalTransactionHash, withdrawal2);
  });
});

function deriveContext({
  ledger = baseLedger(),
  currentRecipientBalance = 300n,
}: {
  ledger?: LedgerEntry[];
  currentRecipientBalance?: bigint;
} = {}) {
  return deriveTargetRecoveryContext({
    plans: basePlans(),
    collections: baseCollections(),
    ledger,
    currentRecipientBalance,
    recipient,
    diagnosis: diagnosisReport(ledger),
  });
}

function basePlans(): PlanReport[] {
  return [
    plan({ planId: "1", budgetRoomId: "2", splitRoomId: "3", collectionRoomId: "4" }),
    plan({ planId: "2", budgetRoomId: "5", splitRoomId: "6", collectionRoomId: "7" }),
  ];
}

function baseCollections(): CollectionRoomReport[] {
  return [
    collection({
      roomId: "4",
      linkedPlanId: "1",
      withdrawalRequestTransactionHashes: [withdrawal1],
    }),
    collection({
      roomId: "7",
      linkedPlanId: "2",
      withdrawalRequestTransactionHashes: [withdrawal2],
    }),
  ];
}

function baseLedger(): LedgerEntry[] {
  return [
    ledgerEntry({
      blockNumber: "10",
      transactionHash: withdrawal1,
      relatedPlanId: "1",
      relatedRoomId: "4",
      decryptedAmount: "150",
      resultingBalance: "150",
    }),
    ledgerEntry({
      blockNumber: "30",
      transactionHash: withdrawal2,
      relatedPlanId: "2",
      relatedRoomId: "7",
      decryptedAmount: "150",
      resultingBalance: "300",
    }),
  ];
}

function diagnosisReport(ledger: LedgerEntry[]): RecipientDiagnosisReport {
  return {
    roleAddresses: { recipient },
    recipientMode: "actor3",
    livePlanTogetherPlans: basePlans(),
    recipientCollectionRooms: baseCollections(),
    chronologicalBalanceLedger: ledger,
  };
}

function plan(overrides: Partial<PlanReport>): PlanReport {
  return {
    planId: "1",
    title: LIVE_PLAN_TOGETHER_TITLE,
    organizer: deployer,
    stage: "Complete",
    budgetRoomId: "2",
    splitRoomId: "3",
    collectionRoomId: "4",
    selectedCost: "150",
    intendedRecipient: recipient,
    creationTransactionHashes: [tx(10)],
    completionTransactionHashes: [completion2],
    ...overrides,
  };
}

function collection(overrides: Partial<CollectionRoomReport>): CollectionRoomReport {
  return {
    roomId: "4",
    organizer: deployer,
    recipient,
    publicTarget: "150",
    collectionStatus: "Withdrawn",
    verifiedContributionCount: "3",
    withdrawalRequestTransactionHashes: [withdrawal1],
    withdrawalFinalizationTransactionHashes: [tx(11)],
    linkedPlanId: "1",
    ...overrides,
  };
}

function ledgerEntry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    blockNumber: "1",
    transactionHash: tx(100),
    event: "ConfidentialTransfer",
    relatedPlanId: null,
    relatedRoomId: null,
    direction: "credit",
    decryptedAmount: "150",
    resultingBalance: "150",
    note: "collection withdrawal credit",
    ...overrides,
  };
}

function unwrapState({
  all = [],
  pending = [],
  finalized = [],
}: {
  all?: UnwrapEventReport[];
  pending?: UnwrapEventReport[];
  finalized?: UnwrapEventReport[];
}): UnwrapStateReport {
  return {
    allUnwrapRequests: all.length === 0 ? pending : all,
    pendingUnwrapRequests: pending,
    finalizedUnwraps: finalized,
  };
}

function emptyUnwrapState(): UnwrapStateReport {
  return unwrapState({});
}

function unwrapEvent({
  amount,
  handle = handleHex(2),
  blockNumber,
}: {
  amount: string;
  handle?: Hex;
  blockNumber: string;
}): UnwrapEventReport {
  return {
    blockNumber,
    transactionHash: tx(Number(blockNumber)),
    encryptedHandle: handle,
    decryptedAmount: amount,
    plaintextAmount: amount,
  };
}

function tx(value: number): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

function handleHex(value: number): Hex {
  return `0x${(value + 500).toString(16).padStart(64, "0")}` as Hex;
}
