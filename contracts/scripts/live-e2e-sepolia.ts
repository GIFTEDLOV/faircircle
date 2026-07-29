import assert from "node:assert/strict";
import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";
import {
  createWalletClient,
  encodeAbiParameters,
  http,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  assertDistinctAddresses,
  assertSepoliaChain,
  createSepoliaClients,
  LIVE_E2E_PATH,
  loadArtifacts,
  loadSepoliaEnv,
  noxComputeAddressForChain,
  normalizePrivateKey,
  oneHourFromNow,
  optionalEnv,
  readDeploymentManifest,
  runSepoliaScript,
  waitForSuccessfulReceipt,
  writeJsonAtomic,
} from "./sepolia-utils.js";

const RoomMode = {
  PlanTogether: 3,
} as const;

const SplitMethod = {
  CapacityWeighted: 1,
} as const;

const CollectionAccess = {
  InviteOnly: 1,
} as const;

const Stage = {
  Complete: 3,
} as const;

const MIN_ACTOR_BALANCE_WEI = 5_000_000_000_000_000n;

type TxLog = Record<string, Hex>;

async function main() {
  loadSepoliaEnv();

  const blocker = await preflightBlocker();
  if (blocker !== undefined) {
    await writeBlockedResult(blocker);
    throw new Error(blocker);
  }

  const gatewayUrl = requiredEnv("NOX_HANDLE_GATEWAY_URL");
  const subgraphUrl = requiredEnv("NOX_SUBGRAPH_URL");
  const manifest = await readDeploymentManifest();
  const artifacts = await loadArtifacts();
  const { publicClient, walletClient: deployerWallet, deployer } =
    createSepoliaClients();
  await assertSepoliaChain(publicClient);
  const noxComputeAddress = noxComputeAddressForChain(await publicClient.getChainId());

  const actors = actorWallets();
  const actorAddresses = actors.map((wallet) => requireAccount(wallet));
  const recipient = requireAccount(recipientWallet());
  assertDistinctAddresses({
    deployer,
    actor1: actorAddresses[0],
    actor2: actorAddresses[1],
    actor3: actorAddresses[2],
    recipient,
  });

  await assertActorBalances(publicClient, [deployerWallet, ...actors, recipientWallet()]);

  const clients = await Promise.all(
    [deployerWallet, ...actors, recipientWallet()].map((wallet) =>
      createViemHandleClient(scopedWallet(wallet), {
        smartContractAddress: noxComputeAddress,
        gatewayUrl,
        subgraphUrl,
      }),
    ),
  );

  const testUsd = manifest.contracts.TestUSD.address;
  const cUsd = manifest.contracts.FairCircleUSD.address;
  const fairCircle = manifest.contracts.FairCircle.address;
  const coordinator = manifest.contracts.FairCirclePlanTogether.address;
  const txs: TxLog = {};

  for (let i = 0; i < actors.length; i += 1) {
    const amount = [40n, 50n, 60n][i];
    txs[`mint actor ${i + 1}`] = await send(
      publicClient,
      deployerWallet,
      testUsd,
      artifacts.TestUSD.abi,
      "mint",
      [actorAddresses[i], amount],
    );
    txs[`approve wrapper actor ${i + 1}`] = await send(
      publicClient,
      actors[i],
      testUsd,
      artifacts.TestUSD.abi,
      "approve",
      [cUsd, amount],
    );
    txs[`wrap actor ${i + 1}`] = await send(
      publicClient,
      actors[i],
      cUsd,
      artifacts.FairCircleUSD.abi,
      "wrap",
      [actorAddresses[i], amount],
    );
  }

  const budgetRoomId = (await publicClient.readContract({
    address: fairCircle,
    abi: artifacts.FairCircle.abi,
    functionName: "nextRoomId",
  })) as bigint;
  txs["create budget room"] = await send(
    publicClient,
    deployerWallet,
    fairCircle,
    artifacts.FairCircle.abi,
    "createQuietBudgetRoom",
    [
      "Sepolia live Plan Together",
      actorAddresses,
      [100n, 150n, 200n],
      oneHourFromNow(),
      RoomMode.PlanTogether,
    ],
  );

  await submitBudgetCapacities(
    publicClient,
    fairCircle,
    artifacts.FairCircle.abi,
    actors,
    clients,
    budgetRoomId,
    [60n, 60n, 40n],
    txs,
  );

  const affordability: boolean[] = [];
  for (let i = 0; i < 3; i += 1) {
    const handle = (await publicClient.readContract({
      address: fairCircle,
      abi: artifacts.FairCircle.abi,
      functionName: "getAffordabilityHandle",
      args: [budgetRoomId, BigInt(i)],
    })) as Hex;
    const proof = await clients[0].publicDecrypt(handle);
    affordability.push(Boolean(proof.value));
    txs[`finalize affordability ${i}`] = await send(
      publicClient,
      deployerWallet,
      fairCircle,
      artifacts.FairCircle.abi,
      "finalizeAffordability",
      [budgetRoomId, BigInt(i), proof.decryptionProof],
    );
  }
  assert.deepEqual(affordability, [true, true, false]);

  const planId = (await publicClient.readContract({
    address: coordinator,
    abi: artifacts.FairCirclePlanTogether.abi,
    functionName: "nextPlanId",
  })) as bigint;
  txs["create coordinator plan"] = await send(
    publicClient,
    deployerWallet,
    coordinator,
    artifacts.FairCirclePlanTogether.abi,
    "createPlanFromBudgetRoom",
    [budgetRoomId, SplitMethod.CapacityWeighted, recipient],
  );
  txs["select option"] = await send(
    publicClient,
    deployerWallet,
    coordinator,
    artifacts.FairCirclePlanTogether.abi,
    "selectAffordableOption",
    [planId, 1n],
  );

  const splitRoomId = (await publicClient.readContract({
    address: fairCircle,
    abi: artifacts.FairCircle.abi,
    functionName: "nextRoomId",
  })) as bigint;
  txs["create weighted split room"] = await send(
    publicClient,
    deployerWallet,
    fairCircle,
    artifacts.FairCircle.abi,
    "createFairSplitRoom",
    [
      "Sepolia live split",
      actorAddresses,
      150n,
      oneHourFromNow(),
      SplitMethod.CapacityWeighted,
    ],
  );

  const shares = await submitSplitAndDecryptShares(
    publicClient,
    fairCircle,
    artifacts.FairCircle.abi,
    actors,
    clients,
    splitRoomId,
    [40n, 50n, 60n],
    txs,
  );
  assert.deepEqual(shares, [40n, 50n, 60n]);

  txs["link split room"] = await send(
    publicClient,
    deployerWallet,
    coordinator,
    artifacts.FairCirclePlanTogether.abi,
    "linkFairSplitRoom",
    [planId, splitRoomId],
  );
  txs["confirm split ready"] = await send(
    publicClient,
    actors[0],
    coordinator,
    artifacts.FairCirclePlanTogether.abi,
    "confirmSplitReady",
    [planId],
  );

  const collectionRoomId = (await publicClient.readContract({
    address: fairCircle,
    abi: artifacts.FairCircle.abi,
    functionName: "nextRoomId",
  })) as bigint;
  txs["create private circle room"] = await send(
    publicClient,
    deployerWallet,
    fairCircle,
    artifacts.FairCircle.abi,
    "createPrivateCircleRoom",
    [
      "Sepolia live collection",
      cUsd,
      recipient,
      150n,
      oneHourFromNow(),
      CollectionAccess.InviteOnly,
      actorAddresses,
    ],
  );
  txs["link collection room"] = await send(
    publicClient,
    deployerWallet,
    coordinator,
    artifacts.FairCirclePlanTogether.abi,
    "linkPrivateCircleRoom",
    [planId, collectionRoomId],
  );

  const contributionIds: bigint[] = [];
  for (let i = 0; i < actors.length; i += 1) {
    const contributionId = (await publicClient.readContract({
      address: fairCircle,
      abi: artifacts.FairCircle.abi,
      functionName: "nextContributionId",
    })) as bigint;
    contributionIds.push(contributionId);
    txs[`contribution ${i + 1}`] = await contribute(
      publicClient,
      cUsd,
      artifacts.FairCircleUSD.abi,
      fairCircle,
      actors[i],
      clients[i + 1],
      collectionRoomId,
      shares[i],
    );
  }

  for (let i = 0; i < contributionIds.length; i += 1) {
    const handle = (await publicClient.readContract({
      address: fairCircle,
      abi: artifacts.FairCircle.abi,
      functionName: "getContributionPositivityHandle",
      args: [contributionIds[i]],
    })) as Hex;
    const proof = await clients[0].publicDecrypt(handle);
    assert.equal(proof.value, true);
    txs[`finalize contribution ${i + 1}`] = await send(
      publicClient,
      deployerWallet,
      fairCircle,
      artifacts.FairCircle.abi,
      "finalizeContribution",
      [contributionIds[i], proof.decryptionProof],
    );
  }

  const targetHandle = (await publicClient.readContract({
    address: fairCircle,
    abi: artifacts.FairCircle.abi,
    functionName: "getCollectionTargetHandle",
    args: [collectionRoomId],
  })) as Hex;
  const targetProof = await clients[0].publicDecrypt(targetHandle);
  assert.equal(targetProof.value, true);
  txs["finalize collection target"] = await send(
    publicClient,
    deployerWallet,
    fairCircle,
    artifacts.FairCircle.abi,
    "finalizeCollectionTarget",
    [collectionRoomId, targetProof.decryptionProof],
  );
  txs["close collection"] = await send(
    publicClient,
    deployerWallet,
    fairCircle,
    artifacts.FairCircle.abi,
    "closePrivateCircle",
    [collectionRoomId],
  );
  txs["request withdrawal"] = await send(
    publicClient,
    deployerWallet,
    fairCircle,
    artifacts.FairCircle.abi,
    "requestCollectionWithdrawal",
    [collectionRoomId],
  );

  const withdrawalHandle = (await publicClient.readContract({
    address: fairCircle,
    abi: artifacts.FairCircle.abi,
    functionName: "getWithdrawalSuccessHandle",
    args: [collectionRoomId],
  })) as Hex;
  const withdrawalProof = await clients[0].publicDecrypt(withdrawalHandle);
  assert.equal(withdrawalProof.value, true);
  txs["finalize withdrawal"] = await send(
    publicClient,
    deployerWallet,
    fairCircle,
    artifacts.FairCircle.abi,
    "finalizeCollectionWithdrawal",
    [collectionRoomId, withdrawalProof.decryptionProof],
  );
  txs["complete plan"] = await send(
    publicClient,
    actors[0],
    coordinator,
    artifacts.FairCirclePlanTogether.abi,
    "completePlan",
    [planId],
  );

  const finalPlan = (await publicClient.readContract({
    address: coordinator,
    abi: artifacts.FairCirclePlanTogether.abi,
    functionName: "getPlan",
    args: [planId],
  })) as readonly unknown[];
  assert.equal(finalPlan[3], Stage.Complete);

  const recipientBalanceHandle = (await publicClient.readContract({
    address: cUsd,
    abi: artifacts.FairCircleUSD.abi,
    functionName: "confidentialBalanceOf",
    args: [recipient],
  })) as Hex;
  const recipientConfidentialBalance = await clients[4].decrypt(recipientBalanceHandle);
  assert.equal(recipientConfidentialBalance.value, 150n);

  const recipientPublicBefore = (await publicClient.readContract({
    address: testUsd,
    abi: artifacts.TestUSD.abi,
    functionName: "balanceOf",
    args: [recipient],
  })) as bigint;
  const unwrapInput = await clients[4].encryptInput(150n, "uint256", cUsd);
  txs["unwrap request"] = await send(
    publicClient,
    recipientWallet(),
    cUsd,
    artifacts.FairCircleUSD.abi,
    "unwrap",
    [recipient, recipient, unwrapInput.handle, unwrapInput.handleProof],
  );
  const unwrapReceipt = await publicClient.getTransactionReceipt({
    hash: txs["unwrap request"],
  });
  const [unwrapEvent] = parseEventLogs({
    abi: artifacts.FairCircleUSD.abi as Abi,
    eventName: "UnwrapRequested",
    logs: unwrapReceipt.logs,
  });
  const unwrapHandle = (unwrapEvent.args as { amount: Hex }).amount;
  const unwrapProof = await clients[0].publicDecrypt(unwrapHandle);
  assert.equal(unwrapProof.value, 150n);
  txs["finalize unwrap"] = await send(
    publicClient,
    deployerWallet,
    cUsd,
    artifacts.FairCircleUSD.abi,
    "finalizeUnwrap",
    [unwrapHandle, unwrapProof.decryptionProof],
  );

  const recipientPublicAfter = (await publicClient.readContract({
    address: testUsd,
    abi: artifacts.TestUSD.abi,
    functionName: "balanceOf",
    args: [recipient],
  })) as bigint;
  assert.equal(recipientPublicAfter - recipientPublicBefore, 150n);

  const confidentialityChecks = {
    deployerCannotReadActor1Capacity: !((await publicClient.readContract({
      address: fairCircle,
      abi: artifacts.FairCircle.abi,
      functionName: "isCapacityAllowed",
      args: [budgetRoomId, actorAddresses[0], deployer],
    })) as boolean),
    actor1CanReadOwnShare: (await publicClient.readContract({
      address: fairCircle,
      abi: artifacts.FairCircle.abi,
      functionName: "isShareAllowed",
      args: [splitRoomId, actorAddresses[0], actorAddresses[0]],
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

  const allReceipts = await Promise.all(
    Object.values(txs).map((hash) => publicClient.getTransactionReceipt({ hash })),
  );
  const coordinatorTransfers = allReceipts.flatMap((receipt) =>
    parseEventLogs({
      abi: artifacts.FairCircleUSD.abi as Abi,
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
  assert.equal(coordinatorTransfers.length, 0);

  await writeJsonAtomic(LIVE_E2E_PATH, {
    schemaVersion: 1,
    network: manifest.network,
    status: "passed",
    timestamp: new Date().toISOString(),
    deployer,
    actors: actorAddresses,
    recipient,
    planId: planId.toString(),
    budgetRoomId: budgetRoomId.toString(),
    splitRoomId: splitRoomId.toString(),
    collectionRoomId: collectionRoomId.toString(),
    selectedCost: "150",
    affordability,
    shares: shares.map((share) => share.toString()),
    recipientPublicDelta: (recipientPublicAfter - recipientPublicBefore).toString(),
    coordinatorConfidentialTransferEvents: coordinatorTransfers.length,
    confidentialityChecks,
    transactionHashes: txs,
  });

  console.log(`Live Plan Together E2E passed. Result: ${LIVE_E2E_PATH}`);
}

async function preflightBlocker() {
  const missing = [
    "SEPOLIA_RPC_URL",
    "DEPLOYER_PRIVATE_KEY",
    "NOX_HANDLE_GATEWAY_URL",
    "NOX_SUBGRAPH_URL",
    "SEPOLIA_ACTOR_1_PRIVATE_KEY",
    "SEPOLIA_ACTOR_2_PRIVATE_KEY",
    "SEPOLIA_ACTOR_3_PRIVATE_KEY",
    "SEPOLIA_RECIPIENT_PRIVATE_KEY",
  ].filter((name) => optionalEnv(name) === undefined);
  if (missing.length > 0) {
    return `Missing required live E2E environment variables: ${missing.join(", ")}`;
  }
  return undefined;
}

async function writeBlockedResult(blocker: string) {
  await writeJsonAtomic(LIVE_E2E_PATH, {
    schemaVersion: 1,
    network: { name: "ethereum-sepolia", chainId: 11155111 },
    status: "blocked",
    timestamp: new Date().toISOString(),
    blocker,
  });
}

async function submitBudgetCapacities(
  publicClient: PublicClient,
  fairCircle: Address,
  fairCircleAbi: Abi,
  actors: WalletClient[],
  clients: HandleClient[],
  roomId: bigint,
  capacities: bigint[],
  txs: TxLog,
) {
  for (let i = 0; i < actors.length; i += 1) {
    const input = await clients[i + 1].encryptInput(capacities[i], "uint256", fairCircle);
    txs[`submit budget capacity ${i + 1}`] = await send(
      publicClient,
      actors[i],
      fairCircle,
      fairCircleAbi,
      "submitPrivateCapacity",
      [roomId, input.handle, input.handleProof],
    );
  }
}

async function submitSplitAndDecryptShares(
  publicClient: PublicClient,
  fairCircle: Address,
  fairCircleAbi: Abi,
  actors: WalletClient[],
  clients: HandleClient[],
  roomId: bigint,
  capacities: bigint[],
  txs: TxLog,
) {
  for (let i = 0; i < actors.length; i += 1) {
    const input = await clients[i + 1].encryptInput(capacities[i], "uint256", fairCircle);
    txs[`submit split capacity ${i + 1}`] = await send(
      publicClient,
      actors[i],
      fairCircle,
      fairCircleAbi,
      "submitSplitCapacity",
      [roomId, input.handle, input.handleProof],
    );
  }
  const feasibilityHandle = (await publicClient.readContract({
    address: fairCircle,
    abi: fairCircleAbi,
    functionName: "getSplitFeasibilityHandle",
    args: [roomId],
  })) as Hex;
  const proof = await clients[0].publicDecrypt(feasibilityHandle);
  assert.equal(proof.value, true);
  txs["finalize split feasibility"] = await send(
    publicClient,
    actors[0],
    fairCircle,
    fairCircleAbi,
    "finalizeSplitFeasibility",
    [roomId, proof.decryptionProof],
  );

  const shares: bigint[] = [];
  for (let i = 0; i < actors.length; i += 1) {
    const handle = (await publicClient.readContract({
      address: fairCircle,
      abi: fairCircleAbi,
      functionName: "getMyShareHandle",
      args: [roomId],
      account: requireAccount(actors[i]),
    })) as Hex;
    shares.push((await clients[i + 1].decrypt(handle)).value as bigint);
  }
  return shares;
}

async function contribute(
  publicClient: PublicClient,
  cUsd: Address,
  cUsdAbi: Abi,
  fairCircle: Address,
  actor: WalletClient,
  client: HandleClient,
  roomId: bigint,
  amount: bigint,
) {
  const input = await client.encryptInput(amount, "uint256", cUsd);
  return send(
    publicClient,
    actor,
    cUsd,
    cUsdAbi,
    "confidentialTransferAndCall",
    [fairCircle, input.handle, input.handleProof, roomData(roomId)],
  );
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

async function assertActorBalances(publicClient: PublicClient, wallets: WalletClient[]) {
  for (const wallet of wallets) {
    const address = requireAccount(wallet);
    const balance = await publicClient.getBalance({ address });
    if (balance < MIN_ACTOR_BALANCE_WEI) {
      throw new Error(
        `${address} has insufficient Sepolia ETH for live E2E. Minimum required: ${MIN_ACTOR_BALANCE_WEI.toString()} wei.`,
      );
    }
  }
}

function actorWallets() {
  return [
    "SEPOLIA_ACTOR_1_PRIVATE_KEY",
    "SEPOLIA_ACTOR_2_PRIVATE_KEY",
    "SEPOLIA_ACTOR_3_PRIVATE_KEY",
  ].map((name) => walletFromPrivateKey(requiredEnv(name)));
}

function recipientWallet() {
  return walletFromPrivateKey(requiredEnv("SEPOLIA_RECIPIENT_PRIVATE_KEY"));
}

function walletFromPrivateKey(value: string) {
  return createWalletClient({
    account: privateKeyToAccount(normalizePrivateKey(value)),
    chain: sepolia,
    transport: http(requiredEnv("SEPOLIA_RPC_URL")),
  });
}

function requiredEnv(name: string) {
  const value = optionalEnv(name);
  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requireAccount(wallet: WalletClient): Address {
  assert.ok(wallet.account, "wallet account is available");
  return wallet.account.address;
}

function roomData(roomId: bigint) {
  return encodeAbiParameters([{ type: "uint256" }], [roomId]);
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

await runSepoliaScript(main);
