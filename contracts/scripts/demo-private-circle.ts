import assert from "node:assert/strict";
import { test } from "node:test";
import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";
import {
  handleGatewayUrl,
  NOX_COMPUTE_ADDRESS,
  nox,
} from "@iexec-nox/nox-hardhat-plugin";
import { encodeAbiParameters, type Address, type Hex, type WalletClient } from "viem";

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
    await fundConfidentialUsd(testUsd, confidentialUsd, member, 500n);
  }

  const roomId = await fairCircle.read.nextRoomId();
  const deadline = await futureDeadline(connection);
  await fairCircle.write.createPrivateCircleRoom([
    "Demo Private Circle",
    confidentialUsd.address,
    recipient,
    120n,
    deadline,
    1,
    [memberA, memberB, memberC],
  ]);

  console.log(`FairCircle deployed: ${fairCircle.address}`);
  console.log(`Confidential token deployed: ${confidentialUsd.address}`);
  console.log(`Private Circle room: ${roomId}`);
  console.log("Target: 120");
  console.log("Submitting confidential contributions: 50 and 70");

  const contributionA = await contribute(fairCircle, confidentialUsd, wallets, clients, roomId, 1, 50n);
  const contributionB = await contribute(fairCircle, confidentialUsd, wallets, clients, roomId, 2, 70n);

  await assert.rejects(
    clients[0].decrypt(
      (await fairCircle.read.getMyContributionHandle([contributionA], {
        account: memberA,
      })) as Hex,
    ),
    /not authorized|decrypt/i,
  );
  console.log(`Organizer ${organizer} cannot decrypt member ${memberA}'s contribution.`);

  await finalizeContribution(fairCircle, clients[0], contributionA);
  await finalizeContribution(fairCircle, clients[0], contributionB);

  const targetProof = await clients[0].publicDecrypt(
    (await fairCircle.read.getCollectionTargetHandle([roomId])) as Hex,
  );
  assert.equal(targetProof.value, true);
  await fairCircle.write.finalizeCollectionTarget([roomId, targetProof.decryptionProof]);

  const circle = await fairCircle.read.getPrivateCircle([roomId]);
  assert.equal(circle.verifiedContributionCount, 2n);
  assert.equal(circle.uniqueContributorCount, 2n);

  console.log(`Verified contributions: ${circle.verifiedContributionCount}`);
  console.log(`Unique contributors: ${circle.uniqueContributorCount}`);
  console.log(`Target reached: ${targetProof.value}`);

  await fairCircle.write.closePrivateCircle([roomId]);
  await fairCircle.write.requestCollectionWithdrawal([roomId]);

  const withdrawalSuccess = await clients[0].publicDecrypt(
    (await fairCircle.read.getWithdrawalSuccessHandle([roomId])) as Hex,
  );
  assert.equal(withdrawalSuccess.value, true);
  await fairCircle.write.finalizeCollectionWithdrawal([
    roomId,
    withdrawalSuccess.decryptionProof,
  ]);

  const withdrawn = await clients[5].decrypt(
    (await fairCircle.read.getWithdrawalHandle([roomId])) as Hex,
  );
  assert.equal(withdrawn.value, 120n);

  await assert.rejects(
    contribute(fairCircle, confidentialUsd, wallets, clients, roomId, 4, 5n),
    /CollectionNotOpen|NotMember|revert/i,
  );
  console.log(`Recipient ${recipient} can decrypt the final collected amount: ${withdrawn.value}`);
  console.log(`Outsider ${outsider} cannot contribute after the collection is closed.`);
});

async function fundConfidentialUsd(
  testUsd: DeployedContract,
  confidentialUsd: DeployedContract,
  account: Address,
  amount: bigint,
) {
  await testUsd.write.mint([account, amount]);
  await testUsd.write.approve([confidentialUsd.address, amount], { account });
  await confidentialUsd.write.wrap([account, amount], { account });
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

  await confidentialUsd.write.confidentialTransferAndCall(
    [fairCircle.address, input.handle, input.handleProof, roomData(roomId)],
    { account: requireAccount(wallets[walletIndex]) },
  );

  return contributionId;
}

async function finalizeContribution(
  fairCircle: DeployedContract,
  client: HandleClient,
  contributionId: bigint,
) {
  const proof = await client.publicDecrypt(
    (await fairCircle.read.getContributionPositivityHandle([contributionId])) as Hex,
  );

  await fairCircle.write.finalizeContribution([
    contributionId,
    proof.decryptionProof,
  ]);
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
