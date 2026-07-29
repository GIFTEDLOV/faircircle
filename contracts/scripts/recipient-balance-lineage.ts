import { type HandleClient } from "@iexec-nox/handle";
import { type Abi, type Address, type Hex, type PublicClient } from "viem";
import {
  asPlanView,
  asPrivateCircleView,
  CollectionStatus,
  Stage,
  type PlanView,
} from "./live-e2e-plan.js";
import {
  HistoricalEventReader,
  type HistoricalEventLog,
} from "./rpc-event-reader.js";

export const LIVE_PLAN_TOGETHER_TITLE = "Sepolia live Plan Together";
export const DIAGNOSED_RECOVERY_AMOUNT = 150n;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export type TxEvidence = Hex[] | "unavailable";

export type PlanReport = {
  planId: string;
  title: string;
  organizer: Address;
  stage: string;
  budgetRoomId: string;
  splitRoomId: string;
  collectionRoomId: string;
  selectedCost: string;
  intendedRecipient: Address;
  creationTransactionHashes: TxEvidence;
  completionTransactionHashes: TxEvidence;
};

export type CollectionRoomReport = {
  roomId: string;
  organizer: Address;
  recipient: Address;
  publicTarget: string;
  collectionStatus: string;
  verifiedContributionCount: string;
  withdrawalRequestTransactionHashes: TxEvidence;
  withdrawalFinalizationTransactionHashes: TxEvidence;
  linkedPlanId: string | null;
};

export type LedgerEntry = {
  blockNumber: string;
  transactionHash: Hex;
  event: string;
  relatedPlanId: string | null;
  relatedRoomId: string | null;
  direction: "credit" | "debit" | "none";
  decryptedAmount: string | "unavailable" | null;
  resultingBalance: string | "unavailable" | null;
  note: string;
};

export type UnwrapEventReport = {
  blockNumber: string;
  transactionHash: Hex;
  encryptedHandle: Hex | null;
  decryptedAmount: string | "unavailable";
  plaintextAmount: string | null;
};

export type UnwrapStateReport = {
  allUnwrapRequests: UnwrapEventReport[];
  pendingUnwrapRequests: UnwrapEventReport[];
  finalizedUnwraps: UnwrapEventReport[];
};

export type RecipientBalanceLineage = {
  ledger: LedgerEntry[];
  derivedBalance: bigint;
  unavailableAmountEvents: number;
};

export type RecipientDiagnosisReport = {
  targetPlanId?: string;
  targetCollectionRoomId?: string;
  roleAddresses?: { recipient?: Address };
  recipientMode?: string;
  plans?: PlanReport[];
  livePlanTogetherPlans?: PlanReport[];
  recipientCollectionRooms?: CollectionRoomReport[];
  chronologicalBalanceLedger?: LedgerEntry[];
};

export type TargetRecoveryContext = {
  source: "diagnosis" | "environment" | "unique-live-plan";
  targetPlan: PlanReport;
  targetCollectionRoom: CollectionRoomReport;
  targetPlanId: bigint;
  targetCollectionRoomId: bigint;
  targetSelectedCost: bigint;
  targetWithdrawalTransactionHash: Hex;
  targetWithdrawalCredit: bigint;
  preExistingRecipientBalance: bigint;
  expectedBalanceBeforeUnwrap: bigint;
  expectedRemainingConfidentialBalance: bigint;
  currentRecipientBalance: bigint;
  balanceLedgerReconciliation: {
    ledgerDerivedBalance: string;
    decryptedCurrentBalance: string;
    matches: boolean;
  };
};

export type TargetUnwrapState =
  | {
      idempotency: "fresh-unwrap";
      expectedCurrentBalance: bigint;
      expectedRemainingConfidentialBalance: bigint;
    }
  | {
      idempotency: "pending-unwrap";
      request: UnwrapEventReport;
      expectedCurrentBalance: bigint;
      expectedRemainingConfidentialBalance: bigint;
    }
  | {
      idempotency: "already-finalized";
      request: UnwrapEventReport;
      finalized: UnwrapEventReport;
      expectedCurrentBalance: bigint;
      expectedRemainingConfidentialBalance: bigint;
    };

export async function enumeratePlans({
  publicClient,
  eventReader,
  coordinator,
  abi,
  deployer,
  fromBlock,
  toBlock,
}: {
  publicClient: PublicClient;
  eventReader: HistoricalEventReader;
  coordinator: Address;
  abi: Abi;
  deployer: Address;
  fromBlock: bigint;
  toBlock: bigint;
}) {
  const created = await readEvents(
    eventReader,
    coordinator,
    abi,
    "PlanCreated",
    { organizer: deployer },
    fromBlock,
    toBlock,
  );
  const completed = await readEvents(
    eventReader,
    coordinator,
    abi,
    "PlanCompleted",
    {},
    fromBlock,
    toBlock,
  );
  const completedByPlanId = groupLogsByArg(completed, "planId");
  const planReports: PlanReport[] = [];
  const seenPlanIds = new Set<string>();

  for (const log of created) {
    const planId = log.args?.planId as bigint | undefined;
    if (planId === undefined) {
      continue;
    }
    const key = planId.toString();
    if (seenPlanIds.has(key)) {
      continue;
    }
    seenPlanIds.add(key);
    const plan = asPlanView(await publicClient.readContract({
      address: coordinator,
      abi,
      functionName: "getPlan",
      args: [planId],
    }));
    if (plan.organizer.toLowerCase() !== deployer.toLowerCase()) {
      continue;
    }
    planReports.push(planReport(plan, txs([log]), txs(completedByPlanId.get(key) ?? [])));
  }

  return planReports.sort((a, b) => compareBigIntString(a.planId, b.planId));
}

export async function enumerateRecipientCollections({
  publicClient,
  eventReader,
  fairCircle,
  coordinator,
  abi,
  coordinatorAbi,
  cUsd,
  recipient,
  fromBlock,
  toBlock,
}: {
  publicClient: PublicClient;
  eventReader: HistoricalEventReader;
  fairCircle: Address;
  coordinator: Address;
  abi: Abi;
  coordinatorAbi: Abi;
  cUsd: Address;
  recipient: Address;
  fromBlock: bigint;
  toBlock: bigint;
}) {
  const created = await readEvents(
    eventReader,
    fairCircle,
    abi,
    "PrivateCircleCreated",
    { confidentialToken: cUsd },
    fromBlock,
    toBlock,
  );
  const withdrawalRequests = await readEvents(
    eventReader,
    fairCircle,
    abi,
    "CollectionWithdrawalRequested",
    { recipient },
    fromBlock,
    toBlock,
  );
  const withdrawals = await readEvents(
    eventReader,
    fairCircle,
    abi,
    "CollectionWithdrawn",
    { recipient },
    fromBlock,
    toBlock,
  );
  const requestByRoom = groupLogsByArg(withdrawalRequests, "roomId");
  const withdrawalByRoom = groupLogsByArg(withdrawals, "roomId");
  const reports: CollectionRoomReport[] = [];

  for (const log of created) {
    const roomId = log.args?.roomId as bigint | undefined;
    if (roomId === undefined) {
      continue;
    }
    const collection = asPrivateCircleView(await publicClient.readContract({
      address: fairCircle,
      abi,
      functionName: "getPrivateCircle",
      args: [roomId],
    }));
    if (collection.recipient.toLowerCase() !== recipient.toLowerCase()) {
      continue;
    }
    const linkedPlan = (await publicClient.readContract({
      address: coordinator,
      abi: coordinatorAbi,
      functionName: "getLinkedPlanForRoom",
      args: [roomId],
    })) as bigint;
    reports.push({
      roomId: roomId.toString(),
      organizer: collection.organizer,
      recipient: collection.recipient,
      publicTarget: collection.publicTarget.toString(),
      collectionStatus: collectionStatusName(Number(collection.collectionStatus)),
      verifiedContributionCount: collection.verifiedContributionCount.toString(),
      withdrawalRequestTransactionHashes: txs(requestByRoom.get(roomId.toString()) ?? []),
      withdrawalFinalizationTransactionHashes: txs(withdrawalByRoom.get(roomId.toString()) ?? []),
      linkedPlanId: linkedPlan === 0n ? null : linkedPlan.toString(),
    });
  }

  return reports.sort((a, b) => compareBigIntString(a.roomId, b.roomId));
}

export async function reconstructBalanceLineage({
  eventReader,
  recipientClient,
  cUsd,
  fairCircle,
  cUsdAbi,
  fairCircleAbi,
  recipient,
  plans,
  collections,
  fromBlock,
  toBlock,
}: {
  publicClient?: PublicClient;
  eventReader: HistoricalEventReader;
  recipientClient: HandleClient;
  cUsd: Address;
  fairCircle: Address;
  cUsdAbi: Abi;
  fairCircleAbi: Abi;
  recipient: Address;
  plans: PlanReport[];
  collections: CollectionRoomReport[];
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<RecipientBalanceLineage> {
  const credits = await readEvents(
    eventReader,
    cUsd,
    cUsdAbi,
    "ConfidentialTransfer",
    { to: recipient },
    fromBlock,
    toBlock,
  );
  const debits = await readEvents(
    eventReader,
    cUsd,
    cUsdAbi,
    "ConfidentialTransfer",
    { from: recipient },
    fromBlock,
    toBlock,
  );
  const withdrawalRequests = await readEvents(
    eventReader,
    fairCircle,
    fairCircleAbi,
    "CollectionWithdrawalRequested",
    { recipient },
    fromBlock,
    toBlock,
  );
  const withdrawalFinalizations = await readEvents(
    eventReader,
    fairCircle,
    fairCircleAbi,
    "CollectionWithdrawn",
    { recipient },
    fromBlock,
    toBlock,
  );
  const withdrawalEvents = dedupeLogs([
    ...withdrawalRequests,
    ...withdrawalFinalizations,
  ]);
  const unwrapRequested = await readEvents(
    eventReader,
    cUsd,
    cUsdAbi,
    "UnwrapRequested",
    { receiver: recipient },
    fromBlock,
    toBlock,
  );
  const unwrapFinalized = await readEvents(
    eventReader,
    cUsd,
    cUsdAbi,
    "UnwrapFinalized",
    { receiver: recipient },
    fromBlock,
    toBlock,
  );

  const collectionByRoomId = new Map(collections.map((room) => [room.roomId, room]));
  const planByCollectionRoomId = new Map(
    plans
      .filter((plan) => plan.collectionRoomId !== "0")
      .map((plan) => [plan.collectionRoomId, plan]),
  );
  const transferLogs = dedupeLogs([...credits, ...debits]);
  const ledger: LedgerEntry[] = [];
  let derivedBalance = 0n;
  let unavailableAmountEvents = 0;

  for (const transfer of transferLogs) {
    const args = transfer.args ?? {};
    const from = args.from as Address | undefined;
    const to = args.to as Address | undefined;
    const amountHandle = args.amount as Hex | undefined;
    const direction = transferDirection(from, to, recipient);
    const amount = amountHandle === undefined
      ? undefined
      : await tryDecrypt(recipientClient, amountHandle);
    let resultingBalance: string | "unavailable";
    if (amount === undefined) {
      unavailableAmountEvents += 1;
      resultingBalance = "unavailable";
    } else {
      if (direction === "credit") {
        derivedBalance += amount;
      } else if (direction === "debit") {
        derivedBalance -= amount;
      }
      resultingBalance = derivedBalance.toString();
    }

    const relatedRoomId = relatedCollectionRoomId(transfer, withdrawalEvents);
    const relatedPlan = relatedRoomId === null
      ? undefined
      : planByCollectionRoomId.get(relatedRoomId);
    ledger.push({
      blockNumber: transfer.blockNumber.toString(),
      transactionHash: transfer.transactionHash,
      event: "ConfidentialTransfer",
      relatedPlanId: relatedPlan?.planId ?? null,
      relatedRoomId,
      direction,
      decryptedAmount: amount?.toString() ?? "unavailable",
      resultingBalance,
      note: transferNote(from, to, recipient, fairCircle, relatedRoomId, collectionByRoomId),
    });
  }

  for (const event of [...unwrapRequested, ...unwrapFinalized]) {
    ledger.push(await unwrapLedgerEntry(event, recipientClient));
  }

  return {
    ledger: ledger.sort(compareLedger),
    derivedBalance,
    unavailableAmountEvents,
  };
}

export async function unwrapStateForRecipient({
  eventReader,
  recipientClient,
  cUsd,
  abi,
  recipient,
  fromBlock,
  toBlock,
}: {
  eventReader: HistoricalEventReader;
  recipientClient: HandleClient;
  cUsd: Address;
  abi: Abi;
  recipient: Address;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<UnwrapStateReport> {
  const requested = await readEvents(
    eventReader,
    cUsd,
    abi,
    "UnwrapRequested",
    { receiver: recipient },
    fromBlock,
    toBlock,
  );
  const finalized = await readEvents(
    eventReader,
    cUsd,
    abi,
    "UnwrapFinalized",
    { receiver: recipient },
    fromBlock,
    toBlock,
  );
  const finalizedHandles = new Set(
    finalized.map((event) => lower(event.args?.encryptedAmount as Hex | undefined)),
  );
  const allUnwrapRequests = await Promise.all(
    requested.map((event) => unwrapEventReport(event, recipientClient, "amount")),
  );

  return {
    allUnwrapRequests,
    pendingUnwrapRequests: allUnwrapRequests.filter(
      (event) => event.encryptedHandle !== null && !finalizedHandles.has(lower(event.encryptedHandle)),
    ),
    finalizedUnwraps: await Promise.all(
      finalized.map((event) => unwrapEventReport(event, recipientClient, "encryptedAmount")),
    ),
  };
}

export function deriveTargetRecoveryContext({
  plans,
  collections,
  ledger,
  currentRecipientBalance,
  recipient,
  diagnosis,
  explicitPlanId,
}: {
  plans: PlanReport[];
  collections: CollectionRoomReport[];
  ledger: LedgerEntry[];
  currentRecipientBalance: bigint;
  recipient: Address;
  diagnosis?: RecipientDiagnosisReport;
  explicitPlanId?: string;
}): TargetRecoveryContext {
  const diagnosisTarget = diagnosis === undefined
    ? undefined
    : targetFromDiagnosis(diagnosis, recipient);
  const explicit = explicitPlanId?.trim() === "" ? undefined : explicitPlanId?.trim();

  if (
    diagnosisTarget !== undefined &&
    explicit !== undefined &&
    explicit !== diagnosisTarget.planId
  ) {
    throw new Error(
      `SEPOLIA_RECOVERY_PLAN_ID ${explicit} conflicts with diagnosed target plan ${diagnosisTarget.planId}.`,
    );
  }

  const targetPlanIdText =
    diagnosisTarget?.planId ??
    explicit ??
    uniqueLivePlanTarget(plans, recipient)?.planId;
  const source = diagnosisTarget !== undefined
    ? "diagnosis"
    : explicit !== undefined
      ? "environment"
      : "unique-live-plan";

  if (targetPlanIdText === undefined) {
    throw new Error(
      "Target recovery plan cannot be uniquely identified. Provide SEPOLIA_RECOVERY_PLAN_ID or a diagnosis report.",
    );
  }

  const targetPlans = plans.filter((plan) => plan.planId === targetPlanIdText);
  if (targetPlans.length !== 1) {
    throw new Error(`Target plan ${targetPlanIdText} was not found exactly once.`);
  }
  const targetPlan = targetPlans[0];
  if (targetPlan.intendedRecipient.toLowerCase() !== recipient.toLowerCase()) {
    throw new Error(
      `Target plan ${targetPlan.planId} intended recipient differs from resolved recipient.`,
    );
  }
  if (targetPlan.stage !== "Complete") {
    throw new Error(`Target plan ${targetPlan.planId} is ${targetPlan.stage}, not Complete.`);
  }

  if (
    diagnosisTarget !== undefined &&
    diagnosisTarget.collectionRoomId !== targetPlan.collectionRoomId
  ) {
    throw new Error(
      `Target collection room ${targetPlan.collectionRoomId} differs from diagnosis ${diagnosisTarget.collectionRoomId}.`,
    );
  }

  const collectionMatches = collections.filter(
    (room) => room.roomId === targetPlan.collectionRoomId,
  );
  if (collectionMatches.length !== 1) {
    throw new Error(
      `Target collection room ${targetPlan.collectionRoomId} was not found exactly once.`,
    );
  }
  const targetCollectionRoom = collectionMatches[0];
  if (targetCollectionRoom.linkedPlanId !== targetPlan.planId) {
    throw new Error(
      `Target collection room ${targetCollectionRoom.roomId} is not linked to plan ${targetPlan.planId}.`,
    );
  }
  if (targetCollectionRoom.recipient.toLowerCase() !== recipient.toLowerCase()) {
    throw new Error(
      `Target collection room ${targetCollectionRoom.roomId} recipient differs from resolved recipient.`,
    );
  }

  const selectedCost = BigInt(targetPlan.selectedCost);
  const withdrawalHashes = new Set(asArray(targetCollectionRoom.withdrawalRequestTransactionHashes).map(lowerHex));
  const targetCredits = ledger.filter(
    (entry) =>
      entry.event === "ConfidentialTransfer" &&
      entry.direction === "credit" &&
      entry.relatedPlanId === targetPlan.planId &&
      entry.relatedRoomId === targetCollectionRoom.roomId &&
      entry.decryptedAmount !== null &&
      entry.decryptedAmount !== "unavailable" &&
      BigInt(entry.decryptedAmount) === selectedCost &&
      withdrawalHashes.has(lowerHex(entry.transactionHash)),
  );

  if (targetCredits.length === 0) {
    throw new Error(
      `Target withdrawal for plan ${targetPlan.planId} cannot be proven from the recipient ledger.`,
    );
  }
  if (targetCredits.length > 1) {
    throw new Error(
      `Target withdrawal for plan ${targetPlan.planId} appears ${targetCredits.length} times in the recipient ledger.`,
    );
  }

  const targetCredit = targetCredits[0];
  if (
    diagnosisTarget?.withdrawalTransactionHash !== undefined &&
    lowerHex(diagnosisTarget.withdrawalTransactionHash) !== lowerHex(targetCredit.transactionHash)
  ) {
    throw new Error(
      `Target withdrawal transaction ${targetCredit.transactionHash} differs from diagnosis ${diagnosisTarget.withdrawalTransactionHash}.`,
    );
  }

  const targetCreditIndex = ledger.indexOf(targetCredit);
  const previousBalance = previousResultingBalance(ledger, targetCreditIndex);
  if (previousBalance === "unavailable") {
    throw new Error(
      `Recipient baseline before target withdrawal for plan ${targetPlan.planId} is unavailable.`,
    );
  }

  const ledgerDerivedBalance = previousResultingBalance(ledger, ledger.length);
  if (ledgerDerivedBalance === "unavailable") {
    throw new Error("Recipient balance ledger cannot derive the current cFUSD balance.");
  }
  if (BigInt(ledgerDerivedBalance) !== currentRecipientBalance) {
    throw new Error(
      `Recipient ledger-derived balance ${ledgerDerivedBalance} does not match decrypted current balance ${currentRecipientBalance.toString()}.`,
    );
  }

  const preExistingRecipientBalance = BigInt(previousBalance);
  const targetWithdrawalCredit = BigInt(targetCredit.decryptedAmount as string);
  if (targetWithdrawalCredit !== selectedCost) {
    throw new Error(
      `Target withdrawal credit ${targetWithdrawalCredit.toString()} differs from selected cost ${selectedCost.toString()}.`,
    );
  }

  return {
    source,
    targetPlan,
    targetCollectionRoom,
    targetPlanId: BigInt(targetPlan.planId),
    targetCollectionRoomId: BigInt(targetCollectionRoom.roomId),
    targetSelectedCost: selectedCost,
    targetWithdrawalTransactionHash: targetCredit.transactionHash,
    targetWithdrawalCredit,
    preExistingRecipientBalance,
    expectedBalanceBeforeUnwrap: preExistingRecipientBalance + selectedCost,
    expectedRemainingConfidentialBalance: preExistingRecipientBalance,
    currentRecipientBalance,
    balanceLedgerReconciliation: {
      ledgerDerivedBalance,
      decryptedCurrentBalance: currentRecipientBalance.toString(),
      matches: true,
    },
  };
}

export function classifyTargetUnwrapState({
  unwrapState,
  planCompletedBlock,
  selectedCost,
  currentRecipientBalance,
  preExistingRecipientBalance,
}: {
  unwrapState: UnwrapStateReport;
  planCompletedBlock: bigint;
  selectedCost: bigint;
  currentRecipientBalance: bigint;
  preExistingRecipientBalance: bigint;
}): TargetUnwrapState {
  const expectedBefore = preExistingRecipientBalance + selectedCost;
  const expectedRemaining = preExistingRecipientBalance;
  const requestsAfter = unwrapState.pendingUnwrapRequests.filter((event) =>
    BigInt(event.blockNumber) >= planCompletedBlock,
  );
  const finalizedAfter = unwrapState.finalizedUnwraps.filter((event) =>
    BigInt(event.blockNumber) >= planCompletedBlock,
  );
  const requestCandidates = requestsAfter.filter((event) =>
    decryptedOrPlaintextAmount(event) === selectedCost.toString(),
  );
  const finalizedCandidates = finalizedAfter.filter((event) =>
    decryptedOrPlaintextAmount(event) === selectedCost.toString(),
  );
  const unrelatedAfter = [...requestsAfter, ...finalizedAfter].filter((event) =>
    decryptedOrPlaintextAmount(event) !== selectedCost.toString(),
  );

  if (unrelatedAfter.length > 0) {
    throw new Error(
      "Unrelated recipient unwrap exists after target PlanCompleted and cannot be distinguished from recovery.",
    );
  }
  if (requestCandidates.length + finalizedCandidates.length > 1) {
    throw new Error("Multiple candidate recipient unwraps exist after target PlanCompleted.");
  }

  if (finalizedCandidates.length === 1) {
    const finalized = finalizedCandidates[0];
    const linkedRequests = unwrapState.allUnwrapRequests.filter(
      (request) =>
        request.encryptedHandle !== null &&
        finalized.encryptedHandle !== null &&
        lower(request.encryptedHandle) === lower(finalized.encryptedHandle),
    );
    if (linkedRequests.length !== 1) {
      throw new Error("Finalized target unwrap does not have exactly one linked request.");
    }
    if (currentRecipientBalance !== expectedRemaining) {
      throw new Error(
        `Expected remaining recipient cFUSD balance ${expectedRemaining.toString()} after finalized unwrap, got ${currentRecipientBalance.toString()}.`,
      );
    }
    return {
      idempotency: "already-finalized",
      request: linkedRequests[0],
      finalized,
      expectedCurrentBalance: expectedRemaining,
      expectedRemainingConfidentialBalance: expectedRemaining,
    };
  }

  if (requestCandidates.length === 1) {
    if (currentRecipientBalance !== expectedRemaining) {
      throw new Error(
        `Expected remaining recipient cFUSD balance ${expectedRemaining.toString()} after pending unwrap request, got ${currentRecipientBalance.toString()}.`,
      );
    }
    return {
      idempotency: "pending-unwrap",
      request: requestCandidates[0],
      expectedCurrentBalance: expectedRemaining,
      expectedRemainingConfidentialBalance: expectedRemaining,
    };
  }

  if (currentRecipientBalance !== expectedBefore) {
    throw new Error(
      `Expected recipient cFUSD balance ${expectedBefore.toString()} before target unwrap, got ${currentRecipientBalance.toString()}.`,
    );
  }

  return {
    idempotency: "fresh-unwrap",
    expectedCurrentBalance: expectedBefore,
    expectedRemainingConfidentialBalance: expectedRemaining,
  };
}

export function evaluateHypotheses({
  currentRecipientBalance,
  plans,
  ledger,
  recipient,
}: {
  currentRecipientBalance: bigint;
  plans: PlanReport[];
  collections: CollectionRoomReport[];
  ledger: LedgerEntry[];
  recipient: Address;
}) {
  const livePlans = plans.filter((plan) => plan.title === LIVE_PLAN_TOGETHER_TITLE);
  const completedLivePlans = livePlans.filter((plan) => plan.stage === "Complete");
  const collectionCredits = ledger.filter(isCollectionCredit);
  const collectionCreditCounts = countBy(
    collectionCredits,
    (entry) => entry.relatedRoomId ?? "",
  );
  const latestLivePlan = completedLivePlans.at(-1);
  const latestLiveCreditIndex = latestLivePlan === undefined
    ? -1
    : ledger.findIndex(
      (entry) =>
        entry.relatedPlanId === latestLivePlan.planId &&
        entry.direction === "credit" &&
        entry.decryptedAmount === DIAGNOSED_RECOVERY_AMOUNT.toString(),
    );
  const balanceBeforeLatestLiveCredit =
    latestLiveCreditIndex <= 0
      ? "unavailable"
      : previousResultingBalance(ledger, latestLiveCreditIndex);

  return {
    twoCompletedCollectionsEachCredited150: collectionCredits.length >= 2,
    sameCollectionWithdrawalCreditedTwice: Object.entries(collectionCreditCounts).some(
      ([, count]) => count > 1,
    ),
    recipientAlreadyHeld150BeforeLatestPlanTogetherRun:
      balanceBeforeLatestLiveCredit === DIAGNOSED_RECOVERY_AMOUNT.toString(),
    priorLiveE2ERunUsedSameRecipient:
      completedLivePlans.filter(
        (plan) => plan.intendedRecipient.toLowerCase() === recipient.toLowerCase(),
      ).length > 1,
    recipientRetainedWrappedCFUSDNotContributed:
      netNonCollectionBalance(ledger) > 0n,
    roleResolutionSelectedDifferentRecipientThanPlan:
      livePlans.some(
        (plan) => plan.intendedRecipient.toLowerCase() !== recipient.toLowerCase(),
      ),
    eventRecoveryOrBalanceDecryptionReadingWrongAddressOrHandle:
      previousResultingBalance(ledger, ledger.length) !== currentRecipientBalance.toString(),
    unrelatedTransactionCreditedRecipient:
      ledger.some(
        (entry) =>
          entry.direction === "credit" &&
          entry.relatedRoomId === null &&
          !entry.note.toLowerCase().includes("wrap") &&
          entry.decryptedAmount !== "0",
      ),
  };
}

export function diagnoseRootCause({
  currentRecipientBalance,
  plans,
  ledger,
  unwrapState,
  recipient,
}: {
  currentRecipientBalance: bigint;
  plans: PlanReport[];
  collections: CollectionRoomReport[];
  ledger: LedgerEntry[];
  unwrapState: UnwrapStateReport;
  recipient: Address;
}) {
  const liveCompleted = plans.filter(
    (plan) =>
      plan.title === LIVE_PLAN_TOGETHER_TITLE &&
      plan.stage === "Complete" &&
      plan.intendedRecipient.toLowerCase() === recipient.toLowerCase(),
  );
  const collectionCredits = ledger.filter(isCollectionCredit);
  const finalizedUnwrap150 = unwrapState.finalizedUnwraps.filter(
    (event) => event.plaintextAmount === DIAGNOSED_RECOVERY_AMOUNT.toString(),
  );
  const supportingTransactionHashes = [
    ...collectionCredits.map((entry) => entry.transactionHash),
    ...liveCompleted.flatMap((plan) => asArray(plan.completionTransactionHashes)),
  ];

  if (
    currentRecipientBalance === 300n &&
    collectionCredits.length >= 2 &&
    finalizedUnwrap150.length === 0
  ) {
    return {
      rootCause:
        "The recipient cFUSD balance is the legitimate accumulated result of two completed Plan Together collection withdrawal requests of 150 cFUSD each to the same recipient, with no finalized unwrap in between.",
      supportingTransactionHashes: [...new Set(supportingTransactionHashes)],
      recommendedSafestRecoveryApproach:
        "Do not assume the latest run owns the whole 300 cFUSD balance. Review the listed completed plans, then resume with an idempotent recovery that unwraps only the latest plan amount of 150 if preserving the prior retained 150 is intended.",
      proposedRecoveryRequiresTransaction: true,
    };
  }

  return {
    rootCause:
      "The current evidence does not prove a safe single-cause explanation. Keep the recovery stopped until the ledger and unwrap state are reviewed.",
    supportingTransactionHashes: [...new Set(supportingTransactionHashes)],
    recommendedSafestRecoveryApproach:
      "Do not unwrap until the unresolved balance lineage entries are explained.",
    proposedRecoveryRequiresTransaction: false,
  };
}

export function txs(logs: HistoricalEventLog[]): TxEvidence {
  const hashes = [...new Set(logs.map((log) => log.transactionHash))];
  return hashes.length === 0 ? "unavailable" : hashes;
}

export function asArray(value: TxEvidence) {
  return value === "unavailable" ? [] : value;
}

export function minBlock(...values: string[]) {
  return values.reduce((min, value) => {
    const block = BigInt(value);
    return block < min ? block : min;
  }, BigInt(values[0]));
}

export async function readEvents(
  eventReader: HistoricalEventReader,
  address: Address,
  abi: Abi,
  eventName: string,
  args: Record<string, unknown>,
  fromBlock: bigint,
  toBlock: bigint,
) {
  return eventReader.readEvents({
    address,
    abi,
    eventName,
    args,
    fromBlock,
    toBlock,
  });
}

function targetFromDiagnosis(
  diagnosis: RecipientDiagnosisReport,
  recipient: Address,
) {
  const explicitPlanId = diagnosis.targetPlanId;
  const explicitCollectionRoomId = diagnosis.targetCollectionRoomId;
  if (explicitPlanId !== undefined) {
    const plan = (diagnosis.livePlanTogetherPlans ?? diagnosis.plans ?? []).find(
      (item) => item.planId === explicitPlanId,
    );
    return {
      planId: explicitPlanId,
      collectionRoomId: explicitCollectionRoomId ?? plan?.collectionRoomId,
      withdrawalTransactionHash: latestDiagnosisWithdrawal(diagnosis, explicitPlanId),
    };
  }

  const ledger = diagnosis.chronologicalBalanceLedger ?? [];
  const collectionCredits = ledger
    .filter(
      (entry) =>
        entry.event === "ConfidentialTransfer" &&
        entry.direction === "credit" &&
        entry.relatedPlanId !== null &&
        entry.relatedRoomId !== null &&
        entry.decryptedAmount !== null &&
        entry.decryptedAmount !== "unavailable",
    )
    .sort(compareLedger);
  const latest = collectionCredits.at(-1);
  if (latest === undefined || latest.relatedPlanId === null || latest.relatedRoomId === null) {
    return undefined;
  }
  const latestPeers = collectionCredits.filter(
    (entry) =>
      entry.blockNumber === latest.blockNumber &&
      entry.transactionHash.toLowerCase() === latest.transactionHash.toLowerCase(),
  );
  if (latestPeers.length !== 1) {
    throw new Error("Diagnosis report does not uniquely identify a target withdrawal.");
  }
  const diagnosisPlans = diagnosis.livePlanTogetherPlans ?? diagnosis.plans ?? [];
  const matchingPlan = diagnosisPlans.filter(
    (plan) =>
      plan.planId === latest.relatedPlanId &&
      plan.collectionRoomId === latest.relatedRoomId &&
      plan.intendedRecipient.toLowerCase() === recipient.toLowerCase(),
  );
  if (matchingPlan.length !== 1) {
    throw new Error("Diagnosis report target plan does not match resolved recipient exactly once.");
  }
  return {
    planId: latest.relatedPlanId,
    collectionRoomId: latest.relatedRoomId,
    withdrawalTransactionHash: latest.transactionHash,
  };
}

function latestDiagnosisWithdrawal(
  diagnosis: RecipientDiagnosisReport,
  planId: string,
) {
  const entry = (diagnosis.chronologicalBalanceLedger ?? [])
    .filter(
      (item) =>
        item.relatedPlanId === planId &&
        item.event === "ConfidentialTransfer" &&
        item.direction === "credit",
    )
    .sort(compareLedger)
    .at(-1);
  return entry?.transactionHash;
}

function uniqueLivePlanTarget(plans: PlanReport[], recipient: Address) {
  const candidates = plans.filter(
    (plan) =>
      plan.title === LIVE_PLAN_TOGETHER_TITLE &&
      plan.stage === "Complete" &&
      plan.intendedRecipient.toLowerCase() === recipient.toLowerCase(),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function planReport(
  plan: PlanView,
  creationTransactionHashes: TxEvidence,
  completionTransactionHashes: TxEvidence,
): PlanReport {
  return {
    planId: plan.id.toString(),
    title: plan.title,
    organizer: plan.organizer,
    stage: stageName(Number(plan.stage)),
    budgetRoomId: plan.budgetRoomId.toString(),
    splitRoomId: plan.splitRoomId.toString(),
    collectionRoomId: plan.collectionRoomId.toString(),
    selectedCost: plan.selectedCost.toString(),
    intendedRecipient: plan.intendedRecipient,
    creationTransactionHashes,
    completionTransactionHashes,
  };
}

async function unwrapEventReport(
  event: HistoricalEventLog,
  recipientClient: HandleClient,
  handleField: "amount" | "encryptedAmount",
) {
  const handle = event.args?.[handleField] as Hex | undefined;
  const decrypted = handle === undefined ? undefined : await tryDecrypt(recipientClient, handle);
  return {
    blockNumber: event.blockNumber.toString(),
    transactionHash: event.transactionHash,
    encryptedHandle: handle ?? null,
    decryptedAmount: decrypted?.toString() ?? "unavailable",
    plaintextAmount: event.args?.plaintextAmount === undefined
      ? null
      : (event.args.plaintextAmount as bigint).toString(),
  };
}

async function unwrapLedgerEntry(
  event: HistoricalEventLog,
  recipientClient: HandleClient,
): Promise<LedgerEntry> {
  const handle =
    (event.args?.amount as Hex | undefined) ??
    (event.args?.encryptedAmount as Hex | undefined);
  const amount = handle === undefined ? undefined : await tryDecrypt(recipientClient, handle);
  return {
    blockNumber: event.blockNumber.toString(),
    transactionHash: event.transactionHash,
    event: event.args?.plaintextAmount === undefined
      ? "UnwrapRequested"
      : "UnwrapFinalized",
    relatedPlanId: null,
    relatedRoomId: null,
    direction: "none",
    decryptedAmount: amount?.toString() ?? (event.args?.plaintextAmount as bigint | undefined)?.toString() ?? "unavailable",
    resultingBalance: null,
    note: event.args?.plaintextAmount === undefined
      ? "unwrap requested; cFUSD debit is represented by the paired burn transfer"
      : "unwrap finalized; public tFUSD transfer occurs but cFUSD balance is unchanged",
  };
}

async function tryDecrypt(client: HandleClient, handle: Hex) {
  try {
    return (await client.decrypt(handle)).value as bigint;
  } catch {
    return undefined;
  }
}

function relatedCollectionRoomId(
  event: HistoricalEventLog,
  withdrawals: HistoricalEventLog[],
) {
  const matching = withdrawals.find(
    (withdrawal) => withdrawal.transactionHash === event.transactionHash,
  );
  const roomId = matching?.args?.roomId as bigint | undefined;
  return roomId?.toString() ?? null;
}

function isCollectionCredit(entry: LedgerEntry) {
  return (
    entry.direction === "credit" &&
    entry.event === "ConfidentialTransfer" &&
    entry.decryptedAmount === DIAGNOSED_RECOVERY_AMOUNT.toString() &&
    entry.relatedRoomId !== null
  );
}

function netNonCollectionBalance(ledger: LedgerEntry[]) {
  return ledger.reduce((balance, entry) => {
    if (
      entry.relatedRoomId !== null ||
      entry.decryptedAmount === "unavailable" ||
      entry.decryptedAmount === null
    ) {
      return balance;
    }
    const amount = BigInt(entry.decryptedAmount);
    if (entry.direction === "credit") {
      return balance + amount;
    }
    if (entry.direction === "debit") {
      return balance - amount;
    }
    return balance;
  }, 0n);
}

function transferDirection(
  from: Address | undefined,
  to: Address | undefined,
  recipient: Address,
) {
  if (to?.toLowerCase() === recipient.toLowerCase()) {
    return "credit";
  }
  if (from?.toLowerCase() === recipient.toLowerCase()) {
    return "debit";
  }
  return "none";
}

function transferNote(
  from: Address | undefined,
  to: Address | undefined,
  recipient: Address,
  fairCircle: Address,
  relatedRoomId: string | null,
  collectionByRoomId: Map<string, CollectionRoomReport>,
) {
  if (from?.toLowerCase() === ZERO_ADDRESS && to?.toLowerCase() === recipient.toLowerCase()) {
    return "wrap or mint credit to recipient";
  }
  if (from?.toLowerCase() === fairCircle.toLowerCase() && to?.toLowerCase() === recipient.toLowerCase()) {
    return relatedRoomId === null
      ? "credit from FairCircle to recipient"
      : `collection withdrawal credit for room ${relatedRoomId}, linked plan ${collectionByRoomId.get(relatedRoomId)?.linkedPlanId ?? "none"}`;
  }
  if (from?.toLowerCase() === recipient.toLowerCase() && to?.toLowerCase() === fairCircle.toLowerCase()) {
    return "recipient contribution debit to FairCircle";
  }
  if (from?.toLowerCase() === recipient.toLowerCase() && to?.toLowerCase() === ZERO_ADDRESS) {
    return "unwrap burn debit from recipient";
  }
  return "recipient cFUSD balance-affecting transfer";
}

function groupLogsByArg(logs: HistoricalEventLog[], argName: string) {
  const groups = new Map<string, HistoricalEventLog[]>();
  for (const log of logs) {
    const value = log.args?.[argName];
    if (typeof value !== "bigint") {
      continue;
    }
    const key = value.toString();
    groups.set(key, [...(groups.get(key) ?? []), log]);
  }
  return groups;
}

function dedupeLogs(logs: HistoricalEventLog[]) {
  const seen = new Set<string>();
  return logs
    .filter((log) => {
      const key = `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort(compareLogs);
}

function compareLogs(a: HistoricalEventLog, b: HistoricalEventLog) {
  if (a.blockNumber === b.blockNumber) {
    return a.logIndex - b.logIndex;
  }
  return a.blockNumber < b.blockNumber ? -1 : 1;
}

function compareLedger(a: LedgerEntry, b: LedgerEntry) {
  const blockA = BigInt(a.blockNumber);
  const blockB = BigInt(b.blockNumber);
  if (blockA === blockB) {
    return a.transactionHash.localeCompare(b.transactionHash);
  }
  return blockA < blockB ? -1 : 1;
}

function previousResultingBalance(ledger: LedgerEntry[], endIndex: number) {
  for (let i = Math.min(endIndex - 1, ledger.length - 1); i >= 0; i -= 1) {
    const value = ledger[i].resultingBalance;
    if (value !== null && value !== "unavailable") {
      return value;
    }
  }
  return "unavailable";
}

function countBy<T>(values: T[], key: (value: T) => string) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const item = key(value);
    counts[item] = (counts[item] ?? 0) + 1;
  }
  return counts;
}

function stageName(stage: number) {
  return Object.entries(Stage).find(([, value]) => value === stage)?.[0] ?? `Unknown(${stage})`;
}

function collectionStatusName(status: number) {
  return Object.entries(CollectionStatus).find(([, value]) => value === status)?.[0] ?? `Unknown(${status})`;
}

function decryptedOrPlaintextAmount(event: UnwrapEventReport) {
  return event.plaintextAmount ?? event.decryptedAmount;
}

function lower(value: Hex | null | undefined) {
  return value?.toLowerCase() ?? "";
}

function lowerHex(value: Hex) {
  return value.toLowerCase();
}

function compareBigIntString(a: string, b: string) {
  const left = BigInt(a);
  const right = BigInt(b);
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
