import assert from "node:assert/strict";
import { test } from "node:test";
import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";
import {
  handleGatewayUrl,
  NOX_COMPUTE_ADDRESS,
  nox,
} from "@iexec-nox/nox-hardhat-plugin";
import type { Address, Hex, WalletClient } from "viem";

type NoxConnection = Awaited<ReturnType<typeof nox.connect>>;
type FairCircle = Awaited<ReturnType<NoxConnection["viem"]["deployContract"]>>;

test("local FairSplit demo", async () => {
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
  const memberD = requireAccount(wallets[4]);
  const outsider = requireAccount(wallets[5]);
  const fairCircle: FairCircle = await connection.viem.deployContract("FairCircle");
  const deadline = await futureDeadline(connection);

  const equalRoomId = await fairCircle.read.nextRoomId();
  await fairCircle.write.createFairSplitRoom([
    "Demo Equal Split",
    [memberA, memberB, memberC],
    100n,
    deadline,
    0,
  ]);

  const equalShares = await decryptShares(fairCircle, clients, equalRoomId, [1, 2, 3]);
  assert.deepEqual(equalShares, [34n, 33n, 33n]);
  await assert.rejects(
    clients[5].decrypt(await shareHandle(fairCircle, equalRoomId, memberA)),
    /not authorized|decrypt/i,
  );

  console.log(`FairCircle deployed: ${fairCircle.address}`);
  console.log("Equal split total: 100");
  console.log(`Equal split shares: ${equalShares.join(", ")}`);
  console.log(`Outsider ${outsider} cannot decrypt an equal-split share.`);

  const weightedRoomId = await fairCircle.read.nextRoomId();
  await fairCircle.write.createFairSplitRoom([
    "Demo Weighted Split",
    [memberA, memberB, memberC, memberD],
    300n,
    deadline,
    1,
  ]);

  await submitCapacity(fairCircle, wallets, clients, weightedRoomId, 1, 40n);
  await submitCapacity(fairCircle, wallets, clients, weightedRoomId, 2, 80n);
  await submitCapacity(fairCircle, wallets, clients, weightedRoomId, 3, 100n);
  await submitCapacity(fairCircle, wallets, clients, weightedRoomId, 4, 180n);

  const memberCapacity = (await fairCircle.read.getMySplitCapacityHandle([weightedRoomId], {
    account: memberA,
  })) as Hex;
  await assert.rejects(clients[0].decrypt(memberCapacity), /not authorized|decrypt/i);

  const feasibilityHandle = (await fairCircle.read.getSplitFeasibilityHandle([
    weightedRoomId,
  ])) as Hex;
  const feasibility = await clients[0].publicDecrypt(feasibilityHandle);
  assert.equal(feasibility.value, true);
  await fairCircle.write.finalizeSplitFeasibility([
    weightedRoomId,
    feasibility.decryptionProof,
  ]);

  const weightedShares = await decryptShares(fairCircle, clients, weightedRoomId, [
    1,
    2,
    3,
    4,
  ]);
  assert.deepEqual(weightedShares, [30n, 60n, 75n, 135n]);
  assert.equal(sum(weightedShares), 300n);

  await assert.rejects(
    clients[0].decrypt(await shareHandle(fairCircle, weightedRoomId, memberA)),
    /not authorized|decrypt/i,
  );

  console.log("Weighted split total: 300");
  console.log("Weighted capacities submitted privately: 40, 80, 100, 180");
  console.log(`Weighted split feasible: ${feasibility.value}`);
  console.log(`Weighted shares: ${weightedShares.join(", ")}`);
  console.log(`Weighted share sum: ${sum(weightedShares)}`);
  console.log(
    `Organizer ${organizer} cannot decrypt another member's capacity or share.`,
  );
});

async function submitCapacity(
  fairCircle: FairCircle,
  wallets: WalletClient[],
  clients: HandleClient[],
  roomId: bigint,
  walletIndex: number,
  value: bigint,
) {
  const input = await clients[walletIndex].encryptInput(
    value,
    "uint256",
    fairCircle.address,
  );

  await fairCircle.write.submitSplitCapacity(
    [roomId, input.handle, input.handleProof],
    { account: requireAccount(wallets[walletIndex]) },
  );
}

async function decryptShares(
  fairCircle: FairCircle,
  clients: HandleClient[],
  roomId: bigint,
  walletIndexes: number[],
) {
  const shares: bigint[] = [];
  for (const walletIndex of walletIndexes) {
    const handle = (await fairCircle.read.getMyShareHandle([roomId], {
      account: requireAccountByIndex(walletIndex),
    })) as Hex;
    shares.push((await clients[walletIndex].decrypt(handle)).value as bigint);
  }
  return shares;
}

async function shareHandle(fairCircle: FairCircle, roomId: bigint, member: Address) {
  return fairCircle.read.getShareHandleForTesting([roomId, member]) as Promise<Hex>;
}

async function futureDeadline(connection: NoxConnection) {
  const publicClient = await connection.viem.getPublicClient();
  return (await publicClient.getBlock()).timestamp + 3600n;
}

function requireAccount(wallet: WalletClient): Address {
  assert.ok(wallet.account, "wallet account is available");
  return wallet.account.address;
}

function requireAccountByIndex(walletIndex: number): Address {
  const accounts = [
    "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
    "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
  ] as const;
  return accounts[walletIndex];
}

function sum(values: bigint[]) {
  return values.reduce((total, value) => total + value, 0n);
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
