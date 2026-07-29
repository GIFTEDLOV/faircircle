import assert from "node:assert/strict";
import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";
import {
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  requireAccount,
  resolveLiveE2ERoles,
} from "./live-e2e-roles.js";
import {
  asPlanView,
  asPrivateCircleView,
  assertPlanComplete,
  CollectionStatus,
} from "./live-e2e-plan.js";
import {
  assertReceiptSuccess,
  assertSepoliaChain,
  createSepoliaClients,
  LIVE_E2E_PATH,
  loadArtifacts,
  loadSepoliaEnv,
  noxComputeAddressForChain,
  optionalEnv,
  readDeploymentManifest,
  runSepoliaScript,
  waitForSuccessfulReceipt,
  writeJsonAtomic,
} from "./sepolia-utils.js";
import {
  HistoricalEventReader,
  safeErrorMessage,
  type HistoricalEventLog,
} from "./rpc-event-reader.js";

const LIVE_TITLE = "Sepolia live Plan Together";
const EXPECTED_SELECTED_COST = 150n;

type EvidenceValue = Hex[] | "unavailable";
type RecoveredEvidence = Record<string, EvidenceValue>;
type EvidenceLogs = {
  PlanCreated: HistoricalEventLog[];
  AffordableOptionSelected: HistoricalEventLog[];
  FairSplitRoomLinked: HistoricalEventLog[];
  FairSplitConfirmed: HistoricalEventLog[];
  PrivateCircleRoomLinked: HistoricalEventLog[];
  PlanCompleted: HistoricalEventLog[];
  budgetRoomCreation: HistoricalEventLog[];
  splitRoomCreation: HistoricalEventLog[];
  collectionRoomCreation: HistoricalEventLog[];
  budgetCapacitySubmissions: HistoricalEventLog[];
  splitCapacitySubmissions: HistoricalEventLog[];
  splitFinalization: HistoricalEventLog[];
  contributions: HistoricalEventLog[];
  contributionFinalizations: HistoricalEventLog[];
  collectionTargetFinalization: HistoricalEventLog[];
  collectionClose: HistoricalEventLog[];
  withdrawalRequest: HistoricalEventLog[];
  withdrawal: HistoricalEventLog[];
  coordinatorTransfers: HistoricalEventLog[];
};

async function main() {
  loadSepoliaEnv();

  const gatewayUrl = requiredEnv("NOX_HANDLE_GATEWAY_URL");
  const subgraphUrl = requiredEnv("NOX_SUBGRAPH_URL");
  const manifest = await readDeploymentManifest();
  const artifacts = await loadArtifacts();
  const { publicClient, walletClient: deployerWallet, deployer } =
    createSepoliaClients();
  await assertSepoliaChain(publicClient);
  const noxComputeAddress = noxComputeAddressForChain(await publicClient.getChainId());

  const roles = resolveLiveE2ERoles({
    deployer,
    deployerWallet,
    rpcUrl: requiredEnv("SEPOLIA_RPC_URL"),
    actorPrivateKeys: [
      requiredEnv("SEPOLIA_ACTOR_1_PRIVATE_KEY"),
      requiredEnv("SEPOLIA_ACTOR_2_PRIVATE_KEY"),
      requiredEnv("SEPOLIA_ACTOR_3_PRIVATE_KEY"),
    ],
    recipientPrivateKey: optionalEnv("SEPOLIA_RECIPIENT_PRIVATE_KEY"),
  });

  const testUsd = manifest.contracts.TestUSD.address;
  const cUsd = manifest.contracts.FairCircleUSD.address;
  const fairCircle = manifest.contracts.FairCircle.address;
  const coordinator = manifest.contracts.FairCirclePlanTogether.address;
  const fromBlock = minBlock(
    manifest.contracts.FairCircle.blockNumber,
    manifest.contracts.FairCirclePlanTogether.blockNumber,
  );
  const recoveryToBlock = await publicClient.getBlockNumber();
  const eventReader = new HistoricalEventReader(publicClient, {
    logger: (message) => console.log(message),
  });

  const planId = await latestPlanId(publicClient, coordinator, artifacts.FairCirclePlanTogether.abi);
  const finalPlan = asPlanView(await publicClient.readContract({
    address: coordinator,
    abi: artifacts.FairCirclePlanTogether.abi,
    functionName: "getPlan",
    args: [planId],
  }));

  assertAddressEqual(finalPlan.organizer, deployer, "plan organizer");
  assert.equal(finalPlan.title, LIVE_TITLE, "plan title");
  assertPlanComplete(finalPlan);
  assert.equal(finalPlan.selectedCost, EXPECTED_SELECTED_COST, "selected cost");
  assertAddressEqual(finalPlan.intendedRecipient, roles.recipient, "intended recipient");
  assertNonZero(finalPlan.budgetRoomId, "budget room ID");
  assertNonZero(finalPlan.splitRoomId, "split room ID");
  assertNonZero(finalPlan.collectionRoomId, "collection room ID");

  const planMembers = (await publicClient.readContract({
    address: coordinator,
    abi: artifacts.FairCirclePlanTogether.abi,
    functionName: "getPlanMembers",
    args: [planId],
  })) as Address[];
  assert.deepEqual(
    planMembers.map((address) => address.toLowerCase()),
    roles.actorAddresses.map((address) => address.toLowerCase()),
    "plan members",
  );

  const collection = asPrivateCircleView(await publicClient.readContract({
    address: fairCircle,
    abi: artifacts.FairCircle.abi,
    functionName: "getPrivateCircle",
    args: [finalPlan.collectionRoomId],
  }));
  assert.equal(
    Number(collection.collectionStatus),
    CollectionStatus.Withdrawn,
    "collection status",
  );

  const evidenceLogs = await recoverEvidenceLogs(
    eventReader,
    artifacts,
    fairCircle,
    coordinator,
    cUsd,
    deployer,
    roles.recipient,
    planId,
    finalPlan.budgetRoomId,
    finalPlan.splitRoomId,
    finalPlan.collectionRoomId,
    fromBlock,
    recoveryToBlock,
  );
  assert.equal(
    evidenceLogs.coordinatorTransfers.length,
    0,
    "coordinator cFUSD transfer activity before resume",
  );

  const planCompletedLog = requireSingleLog(
    evidenceLogs.PlanCompleted,
    "PlanCompleted",
  );
  const evidence = evidenceReport(evidenceLogs);
  await assertEvidenceReceipts(publicClient, evidence);

  const contributionIds = contributionIdsFromLogs(evidenceLogs.contributions);
  if (contributionIds.length === 0) {
    throw new Error("Unable to recover contribution IDs for confidentiality ACL checks.");
  }

  const clientsByAddress = await createHandleClientsByAddress(
    roles.walletsForHandleClients,
    noxComputeAddress,
    gatewayUrl,
    subgraphUrl,
  );
  const deployerClient = handleClientFor(clientsByAddress, deployer);
  const recipientClient = handleClientFor(clientsByAddress, roles.recipient);

  const recipientBalanceHandle = (await publicClient.readContract({
    address: cUsd,
    abi: artifacts.FairCircleUSD.abi,
    functionName: "confidentialBalanceOf",
    args: [roles.recipient],
  })) as Hex;
  const recipientConfidentialBalance = await recipientClient.decrypt(
    recipientBalanceHandle,
  );

  const planCompletedBlock = planCompletedLog.blockNumber;
  const unwrapRecovery = await resumeOrVerifyUnwrap({
    publicClient,
    eventReader,
    deployerWallet,
    recipientWallet: roles.recipientWallet,
    deployerClient,
    recipientClient,
    testUsd,
    testUsdAbi: artifacts.TestUSD.abi,
    cUsd,
    cUsdAbi: artifacts.FairCircleUSD.abi,
    recipient: roles.recipient,
    recipientConfidentialBalance: recipientConfidentialBalance.value as bigint,
    fromBlock: planCompletedBlock,
    toBlock: recoveryToBlock,
  });

  const confidentialityChecks = {
    deployerCannotReadActor1Capacity: !((await publicClient.readContract({
      address: fairCircle,
      abi: artifacts.FairCircle.abi,
      functionName: "isCapacityAllowed",
      args: [finalPlan.budgetRoomId, roles.actorAddresses[0], deployer],
    })) as boolean),
    actor1CanReadOwnShare: (await publicClient.readContract({
      address: fairCircle,
      abi: artifacts.FairCircle.abi,
      functionName: "isShareAllowed",
      args: [finalPlan.splitRoomId, roles.actorAddresses[0], roles.actorAddresses[0]],
    })) as boolean,
    deployerCannotReadActor1Contribution: !((await publicClient.readContract({
      address: fairCircle,
      abi: artifacts.FairCircle.abi,
      functionName: "isContributionReceiptAllowed",
      args: [contributionIds[0], deployer],
    })) as boolean),
  };
  assert.deepEqual(confidentialityChecks, {
    deployerCannotReadActor1Capacity: true,
    actor1CanReadOwnShare: true,
    deployerCannotReadActor1Contribution: true,
  });

  const resumeCoordinatorTransfers = await coordinatorTransfersFromReceipts(
    publicClient,
    artifacts.FairCircleUSD.abi,
    coordinator,
    unwrapRecovery.transactionHashes,
  );
  const coordinatorTransferCount =
    evidenceLogs.coordinatorTransfers.length + resumeCoordinatorTransfers.length;
  assert.equal(
    coordinatorTransferCount,
    0,
    "coordinator cFUSD transfer activity after resume",
  );

  await writeJsonAtomic(LIVE_E2E_PATH, {
    schemaVersion: 1,
    network: manifest.network,
    status: "passed",
    resumed: true,
    recoveryReason:
      "named PlanView tuple decoding failure after successful plan completion",
    timestamp: new Date().toISOString(),
    deployer,
    actors: roles.actorAddresses,
    recipient: roles.recipient,
    recipientMode: roles.recipientMode,
    planId: planId.toString(),
    budgetRoomId: finalPlan.budgetRoomId.toString(),
    splitRoomId: finalPlan.splitRoomId.toString(),
    collectionRoomId: finalPlan.collectionRoomId.toString(),
    selectedCost: EXPECTED_SELECTED_COST.toString(),
    recoveredTransactionHashes: evidence,
    unwrapTransactionHashes: unwrapRecovery.transactionHashes,
    recipientPublicDelta: unwrapRecovery.publicDelta.toString(),
    confidentialityChecks,
    recoveryEventSnapshotBlock: recoveryToBlock.toString(),
    coordinatorConfidentialTransferEvents: coordinatorTransferCount,
    coordinatorTransferCount,
    idempotency: unwrapRecovery.idempotency,
  });

  console.log(`Resumed live Plan Together E2E passed. Result: ${LIVE_E2E_PATH}`);
}

async function latestPlanId(publicClient: PublicClient, coordinator: Address, abi: Abi) {
  const nextPlanId = (await publicClient.readContract({
    address: coordinator,
    abi,
    functionName: "nextPlanId",
  })) as bigint;
  if (nextPlanId <= 1n) {
    throw new Error("No Plan Together plan exists to resume.");
  }
  return nextPlanId - 1n;
}

async function recoverEvidenceLogs(
  eventReader: HistoricalEventReader,
  artifacts: Awaited<ReturnType<typeof loadArtifacts>>,
  fairCircle: Address,
  coordinator: Address,
  cUsd: Address,
  deployer: Address,
  recipient: Address,
  planId: bigint,
  budgetRoomId: bigint,
  splitRoomId: bigint,
  collectionRoomId: bigint,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<EvidenceLogs> {
  const coordinatorAbi = artifacts.FairCirclePlanTogether.abi;
  const fairCircleAbi = artifacts.FairCircle.abi;

  return {
    PlanCreated: await readOptionalEvents(eventReader, coordinator, coordinatorAbi, "PlanCreated", { planId, budgetRoomId, organizer: deployer }, fromBlock, toBlock),
    AffordableOptionSelected: await readOptionalEvents(eventReader, coordinator, coordinatorAbi, "AffordableOptionSelected", { planId, budgetRoomId, optionIndex: 1n }, fromBlock, toBlock),
    FairSplitRoomLinked: await readOptionalEvents(eventReader, coordinator, coordinatorAbi, "FairSplitRoomLinked", { planId, splitRoomId }, fromBlock, toBlock),
    FairSplitConfirmed: await readOptionalEvents(eventReader, coordinator, coordinatorAbi, "FairSplitConfirmed", { planId, splitRoomId }, fromBlock, toBlock),
    PrivateCircleRoomLinked: await readOptionalEvents(eventReader, coordinator, coordinatorAbi, "PrivateCircleRoomLinked", { planId, collectionRoomId, recipient }, fromBlock, toBlock),
    PlanCompleted: await readMandatoryEvents(eventReader, coordinator, coordinatorAbi, "PlanCompleted", { planId, collectionRoomId }, fromBlock, toBlock),
    budgetRoomCreation: await readOptionalEvents(eventReader, fairCircle, fairCircleAbi, "RoomCreated", { roomId: budgetRoomId, organizer: deployer }, fromBlock, toBlock),
    splitRoomCreation: await readOptionalEvents(eventReader, fairCircle, fairCircleAbi, "FairSplitRoomCreated", { roomId: splitRoomId, organizer: deployer }, fromBlock, toBlock),
    collectionRoomCreation: await readOptionalEvents(eventReader, fairCircle, fairCircleAbi, "PrivateCircleCreated", { roomId: collectionRoomId, organizer: deployer, confidentialToken: cUsd }, fromBlock, toBlock),
    budgetCapacitySubmissions: await readOptionalEvents(eventReader, fairCircle, fairCircleAbi, "CapacitySubmitted", { roomId: budgetRoomId }, fromBlock, toBlock),
    splitCapacitySubmissions: await readOptionalEvents(eventReader, fairCircle, fairCircleAbi, "SplitCapacitySubmitted", { roomId: splitRoomId }, fromBlock, toBlock),
    splitFinalization: await readOptionalEvents(eventReader, fairCircle, fairCircleAbi, "SplitFeasibilityFinalized", { roomId: splitRoomId }, fromBlock, toBlock),
    contributions: await readMandatoryEvents(eventReader, fairCircle, fairCircleAbi, "ContributionReceived", { roomId: collectionRoomId }, fromBlock, toBlock),
    contributionFinalizations: await readOptionalEvents(eventReader, fairCircle, fairCircleAbi, "ContributionFinalized", { roomId: collectionRoomId }, fromBlock, toBlock),
    collectionTargetFinalization: await readOptionalEvents(eventReader, fairCircle, fairCircleAbi, "CollectionTargetFinalized", { roomId: collectionRoomId }, fromBlock, toBlock),
    collectionClose: await readOptionalEvents(eventReader, fairCircle, fairCircleAbi, "PrivateCircleClosed", { roomId: collectionRoomId }, fromBlock, toBlock),
    withdrawalRequest: await readOptionalEvents(eventReader, fairCircle, fairCircleAbi, "CollectionWithdrawalRequested", { roomId: collectionRoomId, recipient }, fromBlock, toBlock),
    withdrawal: await readOptionalEvents(eventReader, fairCircle, fairCircleAbi, "CollectionWithdrawn", { roomId: collectionRoomId, recipient }, fromBlock, toBlock),
    coordinatorTransfers: await coordinatorTransferEvents(eventReader, cUsd, artifacts.FairCircleUSD.abi, coordinator, fromBlock, toBlock),
  };
}

async function resumeOrVerifyUnwrap({
  publicClient,
  eventReader,
  deployerWallet,
  recipientWallet,
  deployerClient,
  recipientClient,
  testUsd,
  testUsdAbi,
  cUsd,
  cUsdAbi,
  recipient,
  recipientConfidentialBalance,
  fromBlock,
  toBlock,
}: {
  publicClient: PublicClient;
  eventReader: HistoricalEventReader;
  deployerWallet: WalletClient;
  recipientWallet: WalletClient;
  deployerClient: HandleClient;
  recipientClient: HandleClient;
  testUsd: Address;
  testUsdAbi: Abi;
  cUsd: Address;
  cUsdAbi: Abi;
  recipient: Address;
  recipientConfidentialBalance: bigint;
  fromBlock: bigint;
  toBlock: bigint;
}) {
  const existingFinalized = await findFinalizedUnwrap(
    eventReader,
    cUsd,
    cUsdAbi,
    recipient,
    fromBlock,
    toBlock,
  );
  if (existingFinalized !== undefined) {
    if (recipientConfidentialBalance !== 0n) {
      throw new Error(
        `Expected recipient cFUSD balance 0 after completed unwrap, got ${recipientConfidentialBalance.toString()}.`,
      );
    }
    return {
      idempotency: "already-finalized",
      publicDelta: EXPECTED_SELECTED_COST,
      transactionHashes: {
        unwrapRequest: existingFinalized.requestHash ?? "unavailable",
        finalizeUnwrap: existingFinalized.finalizeHash,
      },
    };
  }

  const pending = await findPendingUnwrap(
    eventReader,
    publicClient,
    cUsd,
    cUsdAbi,
    recipient,
    fromBlock,
    toBlock,
  );
  if (pending !== undefined) {
    if (recipientConfidentialBalance !== 0n) {
      throw new Error(
        `Expected recipient cFUSD balance 0 after pending unwrap request, got ${recipientConfidentialBalance.toString()}.`,
      );
    }
    const recipientPublicBefore = await publicBalance(
      publicClient,
      testUsd,
      testUsdAbi,
      recipient,
    );
    const unwrapProof = await deployerClient.publicDecrypt(pending.handle);
    assert.equal(unwrapProof.value, EXPECTED_SELECTED_COST);
    const finalizeHash = await send(
      publicClient,
      deployerWallet,
      cUsd,
      cUsdAbi,
      "finalizeUnwrap",
      [pending.handle, unwrapProof.decryptionProof],
    );
    const recipientPublicAfter = await publicBalance(
      publicClient,
      testUsd,
      testUsdAbi,
      recipient,
    );
    assert.equal(recipientPublicAfter - recipientPublicBefore, EXPECTED_SELECTED_COST);
    return {
      idempotency: "finalized-pending-unwrap",
      publicDelta: recipientPublicAfter - recipientPublicBefore,
      transactionHashes: {
        unwrapRequest: pending.transactionHash,
        finalizeUnwrap: finalizeHash,
      },
    };
  }

  if (recipientConfidentialBalance !== EXPECTED_SELECTED_COST) {
    throw new Error(
      `Expected recipient cFUSD balance ${EXPECTED_SELECTED_COST.toString()} before unwrap, got ${recipientConfidentialBalance.toString()}.`,
    );
  }

  const recipientPublicBefore = await publicBalance(
    publicClient,
    testUsd,
    testUsdAbi,
    recipient,
  );
  const unwrapInput = await recipientClient.encryptInput(
    EXPECTED_SELECTED_COST,
    "uint256",
    cUsd,
  );
  const unwrapHash = await send(
    publicClient,
    recipientWallet,
    cUsd,
    cUsdAbi,
    "unwrap",
    [recipient, recipient, unwrapInput.handle, unwrapInput.handleProof],
  );
  const unwrapReceipt = await publicClient.getTransactionReceipt({ hash: unwrapHash });
  const [unwrapEvent] = parseEventLogs({
    abi: cUsdAbi,
    eventName: "UnwrapRequested",
    logs: unwrapReceipt.logs,
  });
  assert.ok(unwrapEvent, "UnwrapRequested event emitted");
  const unwrapHandle = (unwrapEvent.args as { amount: Hex }).amount;
  const unwrapProof = await deployerClient.publicDecrypt(unwrapHandle);
  assert.equal(unwrapProof.value, EXPECTED_SELECTED_COST);
  const finalizeHash = await send(
    publicClient,
    deployerWallet,
    cUsd,
    cUsdAbi,
    "finalizeUnwrap",
    [unwrapHandle, unwrapProof.decryptionProof],
  );
  const recipientPublicAfter = await publicBalance(
    publicClient,
    testUsd,
    testUsdAbi,
    recipient,
  );
  assert.equal(recipientPublicAfter - recipientPublicBefore, EXPECTED_SELECTED_COST);

  return {
    idempotency: "fresh-unwrap",
    publicDelta: recipientPublicAfter - recipientPublicBefore,
    transactionHashes: {
      unwrapRequest: unwrapHash,
      finalizeUnwrap: finalizeHash,
    },
  };
}

async function findFinalizedUnwrap(
  eventReader: HistoricalEventReader,
  cUsd: Address,
  cUsdAbi: Abi,
  recipient: Address,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const finalized = (await readMandatoryEvents(
    eventReader,
    cUsd,
    cUsdAbi,
    "UnwrapFinalized",
    { receiver: recipient },
    fromBlock,
    toBlock,
  )).filter((log) => BigInt(log.args?.plaintextAmount as bigint) === EXPECTED_SELECTED_COST);
  const [event] = finalized;
  if (event === undefined) {
    return undefined;
  }
  const encryptedAmount = event.args?.encryptedAmount as Hex | undefined;
  const request = encryptedAmount
    ? (await readMandatoryEvents(
        eventReader,
        cUsd,
        cUsdAbi,
        "UnwrapRequested",
        { receiver: recipient },
        fromBlock,
        toBlock,
      )).find(
      (log) => lower(log.args?.amount as Hex | undefined) === lower(encryptedAmount),
    )
    : undefined;
  return {
    finalizeHash: event.transactionHash,
    requestHash: request?.transactionHash,
  };
}

async function findPendingUnwrap(
  eventReader: HistoricalEventReader,
  publicClient: PublicClient,
  cUsd: Address,
  cUsdAbi: Abi,
  recipient: Address,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const requests = await readMandatoryEvents(
    eventReader,
    cUsd,
    cUsdAbi,
    "UnwrapRequested",
    { receiver: recipient },
    fromBlock,
    toBlock,
  );
  const finalized = await readMandatoryEvents(
    eventReader,
    cUsd,
    cUsdAbi,
    "UnwrapFinalized",
    { receiver: recipient },
    fromBlock,
    toBlock,
  );
  const finalizedHandles = new Set(
    finalized.map((log) => lower(log.args?.encryptedAmount as Hex | undefined)),
  );
  for (const request of requests) {
    const handle = request.args?.amount as Hex | undefined;
    if (handle === undefined || finalizedHandles.has(lower(handle))) {
      continue;
    }
    const requester = (await publicClient.readContract({
      address: cUsd,
      abi: cUsdAbi,
      functionName: "unwrapRequester",
      args: [handle],
    })) as Address;
    if (requester.toLowerCase() === recipient.toLowerCase()) {
      return { handle, transactionHash: request.transactionHash };
    }
  }
  return undefined;
}

function contributionIdsFromLogs(logs: HistoricalEventLog[]) {
  return logs.map((log) => log.args?.contributionId as bigint);
}

async function coordinatorTransferEvents(
  eventReader: HistoricalEventReader,
  cUsd: Address,
  abi: Abi,
  coordinator: Address,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const fromCoordinator = await readMandatoryEvents(
    eventReader,
    cUsd,
    abi,
    "ConfidentialTransfer",
    { from: coordinator },
    fromBlock,
    toBlock,
  );
  const toCoordinator = await readMandatoryEvents(
    eventReader,
    cUsd,
    abi,
    "ConfidentialTransfer",
    { to: coordinator },
    fromBlock,
    toBlock,
  );
  const seen = new Set<string>();
  return [...fromCoordinator, ...toCoordinator].filter((log) => {
    const key = `${log.transactionHash}:${log.logIndex}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function coordinatorTransfersFromReceipts(
  publicClient: PublicClient,
  abi: Abi,
  coordinator: Address,
  hashes: Record<string, Hex | "unavailable">,
) {
  const realHashes = Object.values(hashes).filter(
    (hash): hash is Hex => hash !== "unavailable",
  );
  const receipts = await Promise.all(
    realHashes.map((hash) => publicClient.getTransactionReceipt({ hash })),
  );
  return receipts.flatMap((receipt) =>
    parseEventLogs({
      abi,
      eventName: "ConfidentialTransfer",
      logs: receipt.logs,
    }).filter((event) => {
      const args = event.args as { from: Address; to: Address };
      return (
        args.from.toLowerCase() === coordinator.toLowerCase() ||
        args.to.toLowerCase() === coordinator.toLowerCase()
      );
    }),
  );
}

async function readMandatoryEvents(
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

async function readOptionalEvents(
  eventReader: HistoricalEventReader,
  address: Address,
  abi: Abi,
  eventName: string,
  args: Record<string, unknown>,
  fromBlock: bigint,
  toBlock: bigint,
) {
  try {
    return await readMandatoryEvents(
      eventReader,
      address,
      abi,
      eventName,
      args,
      fromBlock,
      toBlock,
    );
  } catch (error) {
    console.log(
      `Optional historical evidence unavailable for ${eventName}: ${safeErrorMessage(error)}`,
    );
    return [];
  }
}

function requireSingleLog(logs: HistoricalEventLog[], label: string) {
  const [log] = logs;
  if (log === undefined) {
    throw new Error(`${label} event was not found for the completed plan.`);
  }
  return log;
}

function evidenceReport(logs: EvidenceLogs): RecoveredEvidence {
  return {
    PlanCreated: txs(logs.PlanCreated),
    AffordableOptionSelected: txs(logs.AffordableOptionSelected),
    FairSplitRoomLinked: txs(logs.FairSplitRoomLinked),
    FairSplitConfirmed: txs(logs.FairSplitConfirmed),
    PrivateCircleRoomLinked: txs(logs.PrivateCircleRoomLinked),
    PlanCompleted: txs(logs.PlanCompleted),
    budgetRoomCreation: txs(logs.budgetRoomCreation),
    splitRoomCreation: txs(logs.splitRoomCreation),
    collectionRoomCreation: txs(logs.collectionRoomCreation),
    budgetCapacitySubmissions: txs(logs.budgetCapacitySubmissions),
    splitCapacitySubmissions: txs(logs.splitCapacitySubmissions),
    splitFinalization: txs(logs.splitFinalization),
    contributions: txs(logs.contributions),
    contributionFinalizations: txs(logs.contributionFinalizations),
    collectionTargetFinalization: txs(logs.collectionTargetFinalization),
    collectionClose: txs(logs.collectionClose),
    withdrawalRequest: txs(logs.withdrawalRequest),
    withdrawal: txs(logs.withdrawal),
    coordinatorTransfers: txs(logs.coordinatorTransfers),
  };
}

async function assertEvidenceReceipts(
  publicClient: PublicClient,
  evidence: RecoveredEvidence,
) {
  const hashes = Object.values(evidence).flatMap((value) =>
    value === "unavailable" ? [] : value,
  );
  for (const hash of new Set(hashes)) {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    assertReceiptSuccess(receipt, `recovered evidence ${hash}`);
  }
}

async function send(
  publicClient: PublicClient,
  wallet: WalletClient,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
) {
  const hash = await wallet.writeContract({
    address,
    abi,
    functionName,
    args,
  });
  await waitForSuccessfulReceipt(publicClient, hash, functionName);
  return hash;
}

async function publicBalance(
  publicClient: PublicClient,
  token: Address,
  abi: Abi,
  account: Address,
) {
  return publicClient.readContract({
    address: token,
    abi,
    functionName: "balanceOf",
    args: [account],
  }) as Promise<bigint>;
}

async function createHandleClientsByAddress(
  wallets: WalletClient[],
  smartContractAddress: Address,
  gatewayUrl: string,
  subgraphUrl: string,
) {
  const entries = await Promise.all(
    wallets.map(async (wallet) => [
      requireAccount(wallet).toLowerCase(),
      await createViemHandleClient(scopedWallet(wallet), {
        smartContractAddress,
        gatewayUrl,
        subgraphUrl,
      }),
    ] as const),
  );
  return new Map<string, HandleClient>(entries);
}

function handleClientFor(clientsByAddress: Map<string, HandleClient>, address: Address) {
  const client = clientsByAddress.get(address.toLowerCase());
  assert.ok(client, `handle client available for ${address}`);
  return client;
}

function scopedWallet(wallet: WalletClient) {
  assert.ok(wallet.account, "wallet account is available");
  const account = wallet.account;

  return new Proxy(wallet, {
    get(target, property, receiver) {
      if (property === "account") {
        return account;
      }
      if (property === "getAddresses") {
        return async () => [account.address];
      }
      return Reflect.get(target, property, receiver);
    },
  }) as WalletClient;
}

function txs(logs: HistoricalEventLog[]): EvidenceValue {
  const unique = [...new Set(logs.map((log) => log.transactionHash))];
  return unique.length === 0 ? "unavailable" : unique;
}

function assertNonZero(value: bigint, label: string) {
  if (value === 0n) {
    throw new Error(`${label} is zero.`);
  }
}

function assertAddressEqual(actual: Address, expected: Address, label: string) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} mismatch. Expected ${expected}, got ${actual}.`);
  }
}

function minBlock(...values: string[]) {
  return values.reduce((min, value) => {
    const block = BigInt(value);
    return block < min ? block : min;
  }, BigInt(values[0]));
}

function requiredEnv(name: string) {
  const value = optionalEnv(name);
  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function lower(value: Hex | undefined) {
  return value?.toLowerCase() ?? "";
}

await runSepoliaScript(main);
