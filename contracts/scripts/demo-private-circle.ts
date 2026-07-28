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

test("local Private Circle demo", async () => {
  const connection = await nox.connect();
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
  const outsider = requireAccount(wallets[4]);
  const recipient = requireAccount(wallets[5]);

  const testUsd: DeployedContract = await connection.viem.deployContract("TestUSD");
  const confidentialUsd: DeployedContract = await connection.viem.deployContract(
    "FairCircleUSD",
    [testUsd.address],
  );
  const fairCircle: DeployedContract = await connection.viem.deployContract("FairCircle");

  for (const member of [memberA, memberB, memberC]) {
    const { mintHash, approveHash, wrapHash } = await fundConfidentialUsd(
      testUsd,
      confidentialUsd,
      member,
      500n,
    );
    console.log(`Mint tFUSD for ${member}: ${mintHash}`);
    console.log(`Approve wrapper for ${member}: ${approveHash}`);
    console.log(`Wrap tFUSD into cFUSD for ${member}: ${wrapHash}`);
  }

  const roomId = await fairCircle.read.nextRoomId();
  const deadline = await futureDeadline(connection);
  const createHash = await txHash(fairCircle.write.createPrivateCircleRoom([
    "Demo Private Circle",
    confidentialUsd.address,
    recipient,
    150n,
    deadline,
    1,
    [memberA, memberB, memberC],
  ]));

  console.log(`FairCircle deployed: ${fairCircle.address}`);
  console.log(`Confidential token deployed: ${confidentialUsd.address}`);
  console.log(`Private Circle room: ${roomId}`);
  console.log(`Create room transaction: ${createHash}`);
  console.log("Target: 150");
  console.log("Submitting confidential contributions: 50, 70 and 30");

  const contributionA = await contribute(fairCircle, confidentialUsd, wallets, clients, roomId, 1, 50n);
  const contributionB = await contribute(fairCircle, confidentialUsd, wallets, clients, roomId, 2, 70n);
  const contributionC = await contribute(fairCircle, confidentialUsd, wallets, clients, roomId, 3, 30n);
  console.log(`Contribution A transaction: ${contributionA.hash}`);
  console.log(`Contribution B transaction: ${contributionB.hash}`);
  console.log(`Contribution C transaction: ${contributionC.hash}`);

  await assert.rejects(
    clients[0].decrypt(
      (await fairCircle.read.getMyContributionHandle([contributionA.id], {
        account: memberA,
      })) as Hex,
    ),
    /not authorized|decrypt/i,
  );
  console.log(`Organizer ${organizer} cannot decrypt member ${memberA}'s contribution.`);

  const finalizeAHash = await finalizeContribution(fairCircle, clients[0], contributionA.id);
  const finalizeBHash = await finalizeContribution(fairCircle, clients[0], contributionB.id);
  const finalizeCHash = await finalizeContribution(fairCircle, clients[0], contributionC.id);
  console.log(`Finalize contribution A transaction: ${finalizeAHash}`);
  console.log(`Finalize contribution B transaction: ${finalizeBHash}`);
  console.log(`Finalize contribution C transaction: ${finalizeCHash}`);

  const targetProof = await clients[0].publicDecrypt(
    (await fairCircle.read.getCollectionTargetHandle([roomId])) as Hex,
  );
  assert.equal(targetProof.value, true);
  const targetHash = await txHash(
    fairCircle.write.finalizeCollectionTarget([roomId, targetProof.decryptionProof]),
  );

  const circle = await fairCircle.read.getPrivateCircle([roomId]);
  assert.equal(circle.verifiedContributionCount, 3n);
  assert.equal(circle.uniqueContributorCount, 3n);

  const aggregate = await clients[0].decrypt(
    (await fairCircle.read.getCollectionAggregateHandle([roomId])) as Hex,
  );
  assert.equal(aggregate.value, 150n);

  console.log(`Verified contributions: ${circle.verifiedContributionCount}`);
  console.log(`Unique contributors: ${circle.uniqueContributorCount}`);
  console.log(`Target reached: ${targetProof.value}`);
  console.log(`Finalize target transaction: ${targetHash}`);
  console.log(`Organizer decrypted aggregate: ${aggregate.value}`);

  const closeHash = await txHash(fairCircle.write.closePrivateCircle([roomId]));
  const requestWithdrawalHash = await txHash(
    fairCircle.write.requestCollectionWithdrawal([roomId]),
  );

  const withdrawalSuccess = await clients[0].publicDecrypt(
    (await fairCircle.read.getWithdrawalSuccessHandle([roomId])) as Hex,
  );
  assert.equal(withdrawalSuccess.value, true);
  const finalizeWithdrawalHash = await txHash(fairCircle.write.finalizeCollectionWithdrawal([
    roomId,
    withdrawalSuccess.decryptionProof,
  ]));

  const withdrawn = await clients[5].decrypt(
    (await fairCircle.read.getWithdrawalHandle([roomId])) as Hex,
  );
  assert.equal(withdrawn.value, 150n);

  const recipientConfidentialBalance = await clients[5].decrypt(
    (await confidentialUsd.read.confidentialBalanceOf([recipient])) as Hex,
  );
  assert.equal(recipientConfidentialBalance.value, 150n);

  const beforeUnwrapBalance = await testUsd.read.balanceOf([recipient]);
  assert.equal(beforeUnwrapBalance, 0n);
  const unwrap = await requestUnwrap(connection, confidentialUsd, clients, recipient, 5, 150n);
  const finalizeUnwrapHash = await finalizeUnwrap(confidentialUsd, clients[0], unwrap.handle);
  const afterUnwrapBalance = await testUsd.read.balanceOf([recipient]);
  const finalConfidentialBalance = await clients[5].decrypt(
    (await confidentialUsd.read.confidentialBalanceOf([recipient])) as Hex,
  );
  assert.equal(afterUnwrapBalance, 150n);
  assert.equal(finalConfidentialBalance.value, 0n);

  await assert.rejects(
    contribute(fairCircle, confidentialUsd, wallets, clients, roomId, 4, 5n),
    /CollectionNotOpen|NotMember|revert/i,
  );
  console.log(`Close room transaction: ${closeHash}`);
  console.log(`Request withdrawal transaction: ${requestWithdrawalHash}`);
  console.log(`Finalize withdrawal transaction: ${finalizeWithdrawalHash}`);
  console.log(`Recipient ${recipient} can decrypt withdrawn cFUSD: ${withdrawn.value}`);
  console.log(`Recipient confidential cFUSD balance before unwrap: ${recipientConfidentialBalance.value}`);
  console.log(`Unwrap request transaction: ${unwrap.hash}`);
  console.log(`Finalize unwrap transaction: ${finalizeUnwrapHash}`);
  console.log(`Recipient tFUSD balance before unwrap: ${beforeUnwrapBalance}`);
  console.log(`Recipient tFUSD balance after unwrap: ${afterUnwrapBalance}`);
  console.log(`Recipient final confidential cFUSD balance: ${finalConfidentialBalance.value}`);
  console.log(`Outsider ${outsider} cannot contribute after the collection is closed.`);
});

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
  wallets: WalletClient[],
  clients: HandleClient[],
  roomId: bigint,
  walletIndex: number,
  amount: bigint,
) {
  const contributionId = await fairCircle.read.nextContributionId();
  const input = await clients[walletIndex].encryptInput(
    amount,
    "uint256",
    confidentialUsd.address,
  );

  const hash = await txHash(confidentialUsd.write.confidentialTransferAndCall(
    [fairCircle.address, input.handle, input.handleProof, roomData(roomId)],
    { account: requireAccount(wallets[walletIndex]) },
  ));

  return { id: contributionId, hash };
}

async function finalizeContribution(
  fairCircle: DeployedContract,
  client: HandleClient,
  contributionId: bigint,
) {
  const proof = await client.publicDecrypt(
    (await fairCircle.read.getContributionPositivityHandle([contributionId])) as Hex,
  );

  return txHash(fairCircle.write.finalizeContribution([
    contributionId,
    proof.decryptionProof,
  ]));
}

async function requestUnwrap(
  connection: NoxConnection,
  confidentialUsd: DeployedContract,
  clients: HandleClient[],
  recipient: Address,
  walletIndex: number,
  amount: bigint,
) {
  const input = await clients[walletIndex].encryptInput(
    amount,
    "uint256",
    confidentialUsd.address,
  );
  const hash = await txHash(confidentialUsd.write.unwrap(
    [recipient, recipient, input.handle, input.handleProof],
    { account: recipient },
  ));
  const publicClient = await connection.viem.getPublicClient();
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
  return txHash(confidentialUsd.write.finalizeUnwrap([
    unwrapHandle,
    proof.decryptionProof,
  ]));
}

async function futureDeadline(connection: NoxConnection) {
  const publicClient = await connection.viem.getPublicClient();
  return (await publicClient.getBlock()).timestamp + 3600n;
}

function roomData(roomId: bigint) {
  return encodeAbiParameters([{ type: "uint256" }], [roomId]);
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
