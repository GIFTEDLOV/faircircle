import assert from "node:assert/strict";
import { test } from "node:test";
import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";
import {
  handleGatewayUrl,
  NOX_COMPUTE_ADDRESS,
  nox,
} from "@iexec-nox/nox-hardhat-plugin";
import {
  encodeAbiParameters,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";

type NoxConnection = Awaited<ReturnType<typeof nox.connect>>;
type DeployedContract = Awaited<ReturnType<NoxConnection["viem"]["deployContract"]>>;
type Receipt = Awaited<ReturnType<Awaited<ReturnType<NoxConnection["viem"]["getPublicClient"]>>["waitForTransactionReceipt"]>>;

const RoomMode = {
  PlanTogether: 3,
} as const;

const SplitMethod = {
  CapacityWeighted: 1,
} as const;

const CollectionAccess = {
  InviteOnly: 1,
} as const;

const CollectionStatus = {
  Withdrawn: 3,
} as const;

const Stage = {
  Budget: 0,
  Split: 1,
  Collection: 2,
  Complete: 3,
} as const;

test("local Plan Together demo", async () => {
  const connection = await nox.connect();
  const publicClient = await connection.viem.getPublicClient();
  const wallets = await connection.viem.getWalletClients();
  const clients = await Promise.all(
    wallets.slice(0, 6).map((wallet) =>
      createViemHandleClient(scopedWallet(wallet), {
        smartContractAddress: NOX_COMPUTE_ADDRESS,
        gatewayUrl: handleGatewayUrl(),
        subgraphUrl: "https://example.com/subgraphs/id/none",
      }),
    ),
  );

  const organizer = requireAccount(wallets[0]);
  const memberA = requireAccount(wallets[1]);
  const memberB = requireAccount(wallets[2]);
  const memberC = requireAccount(wallets[3]);
  const recipient = requireAccount(wallets[4]);
  const outsider = requireAccount(wallets[5]);
  const members = [memberA, memberB, memberC];
  const txs = new Map<string, Hex>();
  const receipts: Receipt[] = [];

  const testUsd: DeployedContract = await connection.viem.deployContract("TestUSD");
  const confidentialUsd: DeployedContract = await connection.viem.deployContract(
    "FairCircleUSD",
    [testUsd.address],
  );
  const fairCircle: DeployedContract = await connection.viem.deployContract("FairCircle");
  const planTogether: DeployedContract = await connection.viem.deployContract(
    "FairCirclePlanTogether",
    [fairCircle.address, confidentialUsd.address],
  );

  console.log(`TestUSD deployed: ${testUsd.address}`);
  console.log(`FairCircleUSD deployed: ${confidentialUsd.address}`);
  console.log(`FairCircle deployed: ${fairCircle.address}`);
  console.log(`FairCirclePlanTogether deployed: ${planTogether.address}`);

  for (let i = 0; i < members.length; i += 1) {
    const amount = [40n, 50n, 60n][i];
    const { mintHash, approveHash, wrapHash } = await fundConfidentialUsd(
      testUsd,
      confidentialUsd,
      members[i],
      amount,
    );
    txs.set(`mint member ${i + 1}`, mintHash);
    txs.set(`approve wrapper member ${i + 1}`, approveHash);
    txs.set(`wrap member ${i + 1}`, wrapHash);
    receipts.push(await publicClient.waitForTransactionReceipt({ hash: mintHash }));
    receipts.push(await publicClient.waitForTransactionReceipt({ hash: approveHash }));
    receipts.push(await publicClient.waitForTransactionReceipt({ hash: wrapHash }));
  }

  const budgetRoomId = await fairCircle.read.nextRoomId();
  const createBudgetHash = await txHash(fairCircle.write.createQuietBudgetRoom([
    "Plan Together Demo",
    members,
    [100n, 150n, 200n],
    await futureDeadline(connection),
    RoomMode.PlanTogether,
  ]));
  txs.set("create budget room", createBudgetHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: createBudgetHash }));

  const affordability = await finalizeBudget(
    fairCircle,
    clients,
    wallets,
    budgetRoomId,
    [60n, 60n, 40n],
    txs,
    receipts,
    publicClient,
  );
  assert.deepEqual(affordability, [true, true, false]);

  const planId = await planTogether.read.nextPlanId();
  const createPlanHash = await txHash(planTogether.write.createPlanFromBudgetRoom([
    budgetRoomId,
    SplitMethod.CapacityWeighted,
    recipient,
  ]));
  txs.set("create coordinator plan", createPlanHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: createPlanHash }));

  const selectHash = await txHash(planTogether.write.selectAffordableOption([planId, 1n]));
  txs.set("select option 150", selectHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: selectHash }));
  const selectedPlan = await planTogether.read.getPlan([planId]);
  assert.equal(selectedPlan.stage, Stage.Split);
  assert.equal(selectedPlan.selectedCost, 150n);

  const splitRoomId = await fairCircle.read.nextRoomId();
  const createSplitHash = await txHash(fairCircle.write.createFairSplitRoom([
    "Plan Together Split",
    members,
    150n,
    await futureDeadline(connection),
    SplitMethod.CapacityWeighted,
  ]));
  txs.set("create weighted split room", createSplitHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: createSplitHash }));

  const shares = await submitFinalizeAndDecryptShares(
    fairCircle,
    clients,
    wallets,
    splitRoomId,
    [40n, 50n, 60n],
    txs,
    receipts,
    publicClient,
  );
  assert.deepEqual(shares, [40n, 50n, 60n]);
  assert.equal(sum(shares), 150n);

  const linkSplitHash = await txHash(planTogether.write.linkFairSplitRoom([
    planId,
    splitRoomId,
  ]));
  txs.set("link split room", linkSplitHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: linkSplitHash }));

  const confirmSplitHash = await txHash(planTogether.write.confirmSplitReady([planId], {
    account: outsider,
  }));
  txs.set("confirm split ready", confirmSplitHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: confirmSplitHash }));
  assert.equal((await planTogether.read.getPlan([planId])).stage, Stage.Collection);

  const collectionRoomId = await fairCircle.read.nextRoomId();
  const createCollectionHash = await txHash(fairCircle.write.createPrivateCircleRoom([
    "Plan Together Collection",
    confidentialUsd.address,
    recipient,
    150n,
    await futureDeadline(connection),
    CollectionAccess.InviteOnly,
    members,
  ]));
  txs.set("create private circle room", createCollectionHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: createCollectionHash }));

  const linkCollectionHash = await txHash(planTogether.write.linkPrivateCircleRoom([
    planId,
    collectionRoomId,
  ]));
  txs.set("link collection room", linkCollectionHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: linkCollectionHash }));

  const contributionIds: bigint[] = [];
  for (let i = 0; i < members.length; i += 1) {
    const contributionId = await fairCircle.read.nextContributionId();
    contributionIds.push(contributionId);
    const hash = await contribute(
      fairCircle,
      confidentialUsd,
      clients,
      wallets,
      collectionRoomId,
      i + 1,
      shares[i],
    );
    txs.set(`contribution ${i + 1}`, hash);
    receipts.push(await publicClient.waitForTransactionReceipt({ hash }));
  }

  for (let i = 0; i < contributionIds.length; i += 1) {
    const hash = await finalizeContribution(
      fairCircle,
      clients[0],
      contributionIds[i],
    );
    txs.set(`finalize contribution ${i + 1}`, hash);
    receipts.push(await publicClient.waitForTransactionReceipt({ hash }));
  }

  const targetProof = await clients[0].publicDecrypt(
    (await fairCircle.read.getCollectionTargetHandle([collectionRoomId])) as Hex,
  );
  assert.equal(targetProof.value, true);
  const targetHash = await txHash(fairCircle.write.finalizeCollectionTarget([
    collectionRoomId,
    targetProof.decryptionProof,
  ]));
  txs.set("finalize collection target", targetHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: targetHash }));

  const closeHash = await txHash(fairCircle.write.closePrivateCircle([collectionRoomId]));
  txs.set("close collection", closeHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: closeHash }));

  const withdrawalRequestHash = await txHash(
    fairCircle.write.requestCollectionWithdrawal([collectionRoomId]),
  );
  txs.set("request withdrawal", withdrawalRequestHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: withdrawalRequestHash }));

  const withdrawalProof = await clients[0].publicDecrypt(
    (await fairCircle.read.getWithdrawalSuccessHandle([collectionRoomId])) as Hex,
  );
  assert.equal(withdrawalProof.value, true);
  const finalizeWithdrawalHash = await txHash(fairCircle.write.finalizeCollectionWithdrawal([
    collectionRoomId,
    withdrawalProof.decryptionProof,
  ]));
  txs.set("finalize withdrawal", finalizeWithdrawalHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: finalizeWithdrawalHash }));

  const completeHash = await txHash(planTogether.write.completePlan([planId], {
    account: outsider,
  }));
  txs.set("complete plan", completeHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: completeHash }));

  const finalPlan = await planTogether.read.getPlan([planId]);
  assert.equal(finalPlan.stage, Stage.Complete);
  const collection = await fairCircle.read.getPrivateCircle([collectionRoomId]);
  assert.equal(collection.collectionStatus, CollectionStatus.Withdrawn);

  const recipientConfidentialBalance = await clients[4].decrypt(
    (await confidentialUsd.read.confidentialBalanceOf([recipient])) as Hex,
  );
  assert.equal(recipientConfidentialBalance.value, 150n);

  const beforeUnwrapBalance = await testUsd.read.balanceOf([recipient]);
  const unwrap = await requestUnwrap(
    confidentialUsd,
    clients,
    publicClient,
    recipient,
    4,
    150n,
  );
  txs.set("unwrap request", unwrap.hash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: unwrap.hash }));

  const finalizeUnwrapHash = await finalizeUnwrap(confidentialUsd, clients[0], unwrap.handle);
  txs.set("finalize unwrap", finalizeUnwrapHash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash: finalizeUnwrapHash }));

  const afterUnwrapBalance = await testUsd.read.balanceOf([recipient]);
  const finalConfidentialBalance = await clients[4].decrypt(
    (await confidentialUsd.read.confidentialBalanceOf([recipient])) as Hex,
  );
  assert.equal(beforeUnwrapBalance, 0n);
  assert.equal(afterUnwrapBalance, 150n);
  assert.equal(finalConfidentialBalance.value, 0n);

  const coordinatorTransfers = confidentialTransfersInvolving(
    confidentialUsd,
    receipts,
    planTogether.address,
  );
  assert.equal(coordinatorTransfers.length, 0);

  console.log(`Budget room ID: ${budgetRoomId}`);
  console.log(`Split room ID: ${splitRoomId}`);
  console.log(`Collection room ID: ${collectionRoomId}`);
  console.log(`Plan ID: ${planId}`);
  console.log("Public options: 100, 150, 200");
  console.log(`Affordability results: ${affordability.join(", ")}`);
  console.log("Selected option index: 1");
  console.log("Selected public cost: 150");
  console.log(`Coordinator stages: Budget -> Split -> Collection -> Complete`);
  console.log(`Weighted shares: ${shares.join(", ")}`);
  console.log(`Weighted share sum: ${sum(shares)}`);
  console.log(`Target reached: ${targetProof.value}`);
  console.log(`Recipient confidential cFUSD before unwrap: ${recipientConfidentialBalance.value}`);
  console.log(`Recipient tFUSD before unwrap: ${beforeUnwrapBalance}`);
  console.log(`Recipient tFUSD after unwrap: ${afterUnwrapBalance}`);
  console.log(`Recipient final confidential cFUSD: ${finalConfidentialBalance.value}`);
  console.log(`Coordinator cFUSD transfer events: ${coordinatorTransfers.length}`);
  console.log("Transaction hashes:");
  for (const [label, hash] of txs) {
    console.log(`- ${label}: ${hash}`);
  }
});

async function finalizeBudget(
  fairCircle: DeployedContract,
  clients: HandleClient[],
  wallets: WalletClient[],
  roomId: bigint,
  capacities: bigint[],
  txs: Map<string, Hex>,
  receipts: Receipt[],
  publicClient: Awaited<ReturnType<NoxConnection["viem"]["getPublicClient"]>>,
) {
  for (let i = 0; i < capacities.length; i += 1) {
    const input = await clients[i + 1].encryptInput(
      capacities[i],
      "uint256",
      fairCircle.address,
    );
    const hash = await txHash(fairCircle.write.submitPrivateCapacity([
      roomId,
      input.handle,
      input.handleProof,
    ], { account: requireAccount(wallets[i + 1]) }));
    txs.set(`submit budget capacity ${i + 1}`, hash);
    receipts.push(await publicClient.waitForTransactionReceipt({ hash }));
  }

  const results: boolean[] = [];
  for (let optionIndex = 0; optionIndex < 3; optionIndex += 1) {
    const proof = await clients[0].publicDecrypt(
      (await fairCircle.read.getAffordabilityHandle([
        roomId,
        BigInt(optionIndex),
      ])) as Hex,
    );
    results.push(Boolean(proof.value));
    const hash = await txHash(fairCircle.write.finalizeAffordability([
      roomId,
      BigInt(optionIndex),
      proof.decryptionProof,
    ]));
    txs.set(`finalize affordability ${optionIndex}`, hash);
    receipts.push(await publicClient.waitForTransactionReceipt({ hash }));
  }

  return results;
}

async function submitFinalizeAndDecryptShares(
  fairCircle: DeployedContract,
  clients: HandleClient[],
  wallets: WalletClient[],
  roomId: bigint,
  capacities: bigint[],
  txs: Map<string, Hex>,
  receipts: Receipt[],
  publicClient: Awaited<ReturnType<NoxConnection["viem"]["getPublicClient"]>>,
) {
  for (let i = 0; i < capacities.length; i += 1) {
    const input = await clients[i + 1].encryptInput(
      capacities[i],
      "uint256",
      fairCircle.address,
    );
    const hash = await txHash(fairCircle.write.submitSplitCapacity([
      roomId,
      input.handle,
      input.handleProof,
    ], { account: requireAccount(wallets[i + 1]) }));
    txs.set(`submit split capacity ${i + 1}`, hash);
    receipts.push(await publicClient.waitForTransactionReceipt({ hash }));
  }

  const proof = await clients[0].publicDecrypt(
    (await fairCircle.read.getSplitFeasibilityHandle([roomId])) as Hex,
  );
  assert.equal(proof.value, true);
  const hash = await txHash(fairCircle.write.finalizeSplitFeasibility([
    roomId,
    proof.decryptionProof,
  ]));
  txs.set("finalize split feasibility", hash);
  receipts.push(await publicClient.waitForTransactionReceipt({ hash }));

  const shares: bigint[] = [];
  for (let i = 0; i < capacities.length; i += 1) {
    const handle = (await fairCircle.read.getMyShareHandle([roomId], {
      account: requireAccount(wallets[i + 1]),
    })) as Hex;
    shares.push((await clients[i + 1].decrypt(handle)).value as bigint);
  }
  return shares;
}

async function fundConfidentialUsd(
  testUsd: DeployedContract,
  confidentialUsd: DeployedContract,
  account: Address,
  amount: bigint,
) {
  const mintHash = await txHash(testUsd.write.mint([account, amount]));
  const approveHash = await txHash(
    testUsd.write.approve([confidentialUsd.address, amount], { account }),
  );
  const wrapHash = await txHash(confidentialUsd.write.wrap([account, amount], { account }));
  return { mintHash, approveHash, wrapHash };
}

async function contribute(
  fairCircle: DeployedContract,
  confidentialUsd: DeployedContract,
  clients: HandleClient[],
  wallets: WalletClient[],
  roomId: bigint,
  walletIndex: number,
  amount: bigint,
) {
  const input = await clients[walletIndex].encryptInput(
    amount,
    "uint256",
    confidentialUsd.address,
  );
  return txHash(confidentialUsd.write.confidentialTransferAndCall([
    fairCircle.address,
    input.handle,
    input.handleProof,
    roomData(roomId),
  ], { account: requireAccount(wallets[walletIndex]) }));
}

async function finalizeContribution(
  fairCircle: DeployedContract,
  client: HandleClient,
  contributionId: bigint,
) {
  const proof = await client.publicDecrypt(
    (await fairCircle.read.getContributionPositivityHandle([contributionId])) as Hex,
  );
  assert.equal(proof.value, true);
  return txHash(fairCircle.write.finalizeContribution([
    contributionId,
    proof.decryptionProof,
  ]));
}

async function requestUnwrap(
  confidentialUsd: DeployedContract,
  clients: HandleClient[],
  publicClient: Awaited<ReturnType<NoxConnection["viem"]["getPublicClient"]>>,
  recipient: Address,
  walletIndex: number,
  amount: bigint,
) {
  const input = await clients[walletIndex].encryptInput(
    amount,
    "uint256",
    confidentialUsd.address,
  );
  const hash = await txHash(confidentialUsd.write.unwrap([
    recipient,
    recipient,
    input.handle,
    input.handleProof,
  ], { account: recipient }));
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const [event] = parseEventLogs({
    abi: (confidentialUsd as unknown as { abi: Abi }).abi,
    eventName: "UnwrapRequested",
    logs: receipt.logs,
  });
  assert.ok(event, "unwrap request event emitted");
  return { hash, handle: (event.args as { amount: Hex }).amount };
}

async function finalizeUnwrap(
  confidentialUsd: DeployedContract,
  client: HandleClient,
  unwrapHandle: Hex,
) {
  const proof = await client.publicDecrypt(unwrapHandle);
  assert.equal(proof.value, 150n);
  return txHash(confidentialUsd.write.finalizeUnwrap([
    unwrapHandle,
    proof.decryptionProof,
  ]));
}

function confidentialTransfersInvolving(
  confidentialUsd: DeployedContract,
  receipts: Receipt[],
  account: Address,
) {
  const events = receipts.flatMap((receipt) =>
    parseEventLogs({
      abi: (confidentialUsd as unknown as { abi: Abi }).abi,
      eventName: "ConfidentialTransfer",
      logs: receipt.logs,
    }),
  );
  const target = normalize(account);
  return events.filter((event) => {
    const args = event.args as { from: Address; to: Address };
    return normalize(args.from) === target || normalize(args.to) === target;
  });
}

async function futureDeadline(connection: NoxConnection) {
  const publicClient = await connection.viem.getPublicClient();
  return (await publicClient.getBlock()).timestamp + 3600n;
}

function roomData(roomId: bigint) {
  return encodeAbiParameters([{ type: "uint256" }], [roomId]);
}

function sum(values: bigint[]) {
  return values.reduce((total, value) => total + value, 0n);
}

function normalize(address: Address) {
  return address.toLowerCase();
}

function requireAccount(wallet: WalletClient): Address {
  assert.ok(wallet.account, "wallet account is available");
  return wallet.account.address;
}

async function txHash(transaction: Promise<unknown>) {
  const hash = await transaction;
  assert.equal(typeof hash, "string");
  assert.match(hash, /^0x[0-9a-fA-F]{64}$/);
  return hash as Hex;
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
