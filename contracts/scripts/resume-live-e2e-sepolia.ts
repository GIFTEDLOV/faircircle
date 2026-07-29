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

const LIVE_TITLE = "Sepolia live Plan Together";
const EXPECTED_SELECTED_COST = 150n;

type EventLog = {
  transactionHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  args?: Record<string, unknown>;
};

type EvidenceValue = Hex[] | "unavailable";
type RecoveredEvidence = Record<string, EvidenceValue>;

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

  const coordinatorTransfersBefore = await coordinatorTransferEvents(
    publicClient,
    cUsd,
    artifacts.FairCircleUSD.abi,
    coordinator,
    fromBlock,
  );
  assert.equal(
    coordinatorTransfersBefore.length,
    0,
    "coordinator cFUSD transfer activity before resume",
  );

  const evidence = await recoverEvidence(
    publicClient,
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
  );
  await assertEvidenceReceipts(publicClient, evidence);

  const contributionIds = await contributionIdsForCollection(
    publicClient,
    fairCircle,
    artifacts.FairCircle.abi,
    finalPlan.collectionRoomId,
    fromBlock,
  );
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

  const planCompletedBlock = await requiredEventBlock(
    publicClient,
    coordinator,
    artifacts.FairCirclePlanTogether.abi,
    "PlanCompleted",
    { planId, collectionRoomId: finalPlan.collectionRoomId },
    fromBlock,
  );
  const unwrapRecovery = await resumeOrVerifyUnwrap({
    publicClient,
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

  const coordinatorTransfersAfter = await coordinatorTransferEvents(
    publicClient,
    cUsd,
    artifacts.FairCircleUSD.abi,
    coordinator,
    fromBlock,
  );
  assert.equal(
    coordinatorTransfersAfter.length,
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
    coordinatorConfidentialTransferEvents: coordinatorTransfersAfter.length,
    coordinatorTransferCount: coordinatorTransfersAfter.length,
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

async function recoverEvidence(
  publicClient: PublicClient,
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
): Promise<RecoveredEvidence> {
  const coordinatorAbi = artifacts.FairCirclePlanTogether.abi;
  const fairCircleAbi = artifacts.FairCircle.abi;

  return {
    PlanCreated: txs(await events(publicClient, coordinator, coordinatorAbi, "PlanCreated", { planId, budgetRoomId, organizer: deployer }, fromBlock)),
    AffordableOptionSelected: txs(await events(publicClient, coordinator, coordinatorAbi, "AffordableOptionSelected", { planId, budgetRoomId, optionIndex: 1n }, fromBlock)),
    FairSplitRoomLinked: txs(await events(publicClient, coordinator, coordinatorAbi, "FairSplitRoomLinked", { planId, splitRoomId }, fromBlock)),
    FairSplitConfirmed: txs(await events(publicClient, coordinator, coordinatorAbi, "FairSplitConfirmed", { planId, splitRoomId }, fromBlock)),
    PrivateCircleRoomLinked: txs(await events(publicClient, coordinator, coordinatorAbi, "PrivateCircleRoomLinked", { planId, collectionRoomId, recipient }, fromBlock)),
    PlanCompleted: txs(await events(publicClient, coordinator, coordinatorAbi, "PlanCompleted", { planId, collectionRoomId }, fromBlock)),
    budgetRoomCreation: txs(await events(publicClient, fairCircle, fairCircleAbi, "RoomCreated", { roomId: budgetRoomId, organizer: deployer }, fromBlock)),
    splitRoomCreation: txs(await events(publicClient, fairCircle, fairCircleAbi, "FairSplitRoomCreated", { roomId: splitRoomId, organizer: deployer }, fromBlock)),
    collectionRoomCreation: txs(await events(publicClient, fairCircle, fairCircleAbi, "PrivateCircleCreated", { roomId: collectionRoomId, organizer: deployer, confidentialToken: cUsd }, fromBlock)),
    budgetCapacitySubmissions: txs(await events(publicClient, fairCircle, fairCircleAbi, "CapacitySubmitted", { roomId: budgetRoomId }, fromBlock)),
    splitCapacitySubmissions: txs(await events(publicClient, fairCircle, fairCircleAbi, "SplitCapacitySubmitted", { roomId: splitRoomId }, fromBlock)),
    splitFinalization: txs(await events(publicClient, fairCircle, fairCircleAbi, "SplitFeasibilityFinalized", { roomId: splitRoomId }, fromBlock)),
    contributions: txs(await events(publicClient, fairCircle, fairCircleAbi, "ContributionReceived", { roomId: collectionRoomId }, fromBlock)),
    contributionFinalizations: txs(await events(publicClient, fairCircle, fairCircleAbi, "ContributionFinalized", { roomId: collectionRoomId }, fromBlock)),
    collectionTargetFinalization: txs(await events(publicClient, fairCircle, fairCircleAbi, "CollectionTargetFinalized", { roomId: collectionRoomId }, fromBlock)),
    collectionClose: txs(await events(publicClient, fairCircle, fairCircleAbi, "PrivateCircleClosed", { roomId: collectionRoomId }, fromBlock)),
    withdrawalRequest: txs(await events(publicClient, fairCircle, fairCircleAbi, "CollectionWithdrawalRequested", { roomId: collectionRoomId, recipient }, fromBlock)),
    withdrawal: txs(await events(publicClient, fairCircle, fairCircleAbi, "CollectionWithdrawn", { roomId: collectionRoomId, recipient }, fromBlock)),
  };
}

async function resumeOrVerifyUnwrap({
  publicClient,
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
}: {
  publicClient: PublicClient;
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
}) {
  const existingFinalized = await findFinalizedUnwrap(
    publicClient,
    cUsd,
    cUsdAbi,
    recipient,
    fromBlock,
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

  const pending = await findPendingUnwrap(publicClient, cUsd, cUsdAbi, recipient, fromBlock);
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
  publicClient: PublicClient,
  cUsd: Address,
  cUsdAbi: Abi,
  recipient: Address,
  fromBlock: bigint,
) {
  const finalized = (await events(
    publicClient,
    cUsd,
    cUsdAbi,
    "UnwrapFinalized",
    { receiver: recipient },
    fromBlock,
  )).filter((log) => BigInt(log.args?.plaintextAmount as bigint) === EXPECTED_SELECTED_COST);
  const [event] = finalized;
  if (event === undefined) {
    return undefined;
  }
  const encryptedAmount = event.args?.encryptedAmount as Hex | undefined;
  const request = encryptedAmount
    ? (await events(publicClient, cUsd, cUsdAbi, "UnwrapRequested", { receiver: recipient }, fromBlock)).find(
        (log) => lower(log.args?.amount as Hex | undefined) === lower(encryptedAmount),
      )
    : undefined;
  return {
    finalizeHash: event.transactionHash,
    requestHash: request?.transactionHash,
  };
}

async function findPendingUnwrap(
  publicClient: PublicClient,
  cUsd: Address,
  cUsdAbi: Abi,
  recipient: Address,
  fromBlock: bigint,
) {
  const requests = await events(
    publicClient,
    cUsd,
    cUsdAbi,
    "UnwrapRequested",
    { receiver: recipient },
    fromBlock,
  );
  const finalized = await events(
    publicClient,
    cUsd,
    cUsdAbi,
    "UnwrapFinalized",
    { receiver: recipient },
    fromBlock,
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

async function contributionIdsForCollection(
  publicClient: PublicClient,
  fairCircle: Address,
  abi: Abi,
  collectionRoomId: bigint,
  fromBlock: bigint,
) {
  const logs = await events(
    publicClient,
    fairCircle,
    abi,
    "ContributionReceived",
    { roomId: collectionRoomId },
    fromBlock,
  );
  return logs.map((log) => log.args?.contributionId as bigint);
}

async function coordinatorTransferEvents(
  publicClient: PublicClient,
  cUsd: Address,
  abi: Abi,
  coordinator: Address,
  fromBlock: bigint,
) {
  const [fromCoordinator, toCoordinator] = await Promise.all([
    events(publicClient, cUsd, abi, "ConfidentialTransfer", { from: coordinator }, fromBlock),
    events(publicClient, cUsd, abi, "ConfidentialTransfer", { to: coordinator }, fromBlock),
  ]);
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

async function requiredEventBlock(
  publicClient: PublicClient,
  address: Address,
  abi: Abi,
  eventName: string,
  args: Record<string, unknown>,
  fromBlock: bigint,
) {
  const [event] = await events(publicClient, address, abi, eventName, args, fromBlock);
  if (event === undefined) {
    throw new Error(`${eventName} event was not found for the completed plan.`);
  }
  return event.blockNumber;
}

async function events(
  publicClient: PublicClient,
  address: Address,
  abi: Abi,
  eventName: string,
  args: Record<string, unknown>,
  fromBlock: bigint,
) {
  return (await publicClient.getContractEvents({
    address,
    abi,
    eventName,
    args,
    fromBlock,
    toBlock: "latest",
  })) as EventLog[];
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

function txs(logs: EventLog[]): EvidenceValue {
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
