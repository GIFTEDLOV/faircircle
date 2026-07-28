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

test("local QuietBudget demo", async () => {
  const connection = await nox.connect();
  const wallets = await connection.viem.getWalletClients();

  const organizer = requireAccount(wallets[0]);
  const memberA = requireAccount(wallets[1]);
  const memberB = requireAccount(wallets[2]);
  const memberC = requireAccount(wallets[3]);
  const outsider = requireAccount(wallets[4]);

  const clients = await Promise.all(
    wallets.slice(0, 5).map((wallet) =>
      createViemHandleClient(scopedWallet(wallet), {
        smartContractAddress: NOX_COMPUTE_ADDRESS,
        gatewayUrl: handleGatewayUrl(),
        subgraphUrl: "https://example.com/subgraphs/id/none",
      }),
    ),
  );

  const fairCircle: FairCircle = await connection.viem.deployContract("FairCircle");
  const roomId = await fairCircle.read.nextRoomId();
  const publicClient = await connection.viem.getPublicClient();
  const deadline = (await publicClient.getBlock()).timestamp + 3600n;

  await fairCircle.write.createQuietBudgetRoom([
    "Demo QuietBudget",
    [memberA, memberB, memberC],
    [150n, 220n, 250n],
    deadline,
    0,
  ]);

  console.log(`FairCircle deployed: ${fairCircle.address}`);
  console.log(`QuietBudget room: ${roomId}`);
  console.log("Options: 150, 220, 250");
  console.log("Submitting encrypted capacities: 40, 80, 100");

  await submit(fairCircle, wallets, clients, roomId, 1, 40n);
  await submit(fairCircle, wallets, clients, roomId, 2, 80n);
  await submit(fairCircle, wallets, clients, roomId, 3, 100n);

  const memberCapacityHandle = (await fairCircle.read.getMyCapacityHandle([roomId], {
    account: memberA,
  })) as Hex;

  await assert.rejects(
    clients[4].decrypt(memberCapacityHandle),
    /not authorized|does not exist|decrypt/i,
  );
  console.log(`Unauthorized decrypt rejected for outsider ${outsider}`);

  const results: boolean[] = [];
  for (let optionIndex = 0; optionIndex < 3; optionIndex += 1) {
    const handle = (await fairCircle.read.getAffordabilityHandle([
      roomId,
      BigInt(optionIndex),
    ])) as Hex;
    const publicResult = await clients[0].publicDecrypt(handle);

    await fairCircle.write.finalizeAffordability([
      roomId,
      BigInt(optionIndex),
      publicResult.decryptionProof,
    ]);

    results.push(Boolean(publicResult.value));
  }

  assert.deepEqual(results, [true, true, false]);
  const room = (await fairCircle.read.getRoom([roomId])) as { status: number };
  assert.equal(room.status, 2);

  console.log("Final affordability results: true, true, false");
  console.log(`Organizer ${organizer} never receives other members' capacity ACLs.`);
});

async function submit(
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

  await fairCircle.write.submitPrivateCapacity(
    [roomId, input.handle, input.handleProof],
    { account: requireAccount(wallets[walletIndex]) },
  );
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
