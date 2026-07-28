import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";
import {
  handleGatewayUrl,
  NOX_COMPUTE_ADDRESS,
  nox,
} from "@iexec-nox/nox-hardhat-plugin";
import type { Address, Hex, WalletClient } from "viem";

type NoxConnection = Awaited<ReturnType<typeof nox.connect>>;
type FairCircle = Awaited<ReturnType<NoxConnection["viem"]["deployContract"]>>;

const RoomMode = {
  QuietBudget: 0,
  FairSplit: 1,
} as const;

const RoomStatus = {
  CollectingInputs: 0,
  ReadyForDecryption: 1,
  Finalized: 2,
  Cancelled: 3,
} as const;

const SplitMethod = {
  Equal: 0,
  CapacityWeighted: 1,
} as const;

describe("FairCircle FairSplit", () => {
  let connection: NoxConnection;
  let fairCircle: FairCircle;
  let wallets: WalletClient[];
  let clients: HandleClient[];
  let organizer: Address;
  let memberA: Address;
  let memberB: Address;
  let memberC: Address;
  let memberD: Address;
  let outsider: Address;

  beforeEach(async () => {
    connection = await nox.connect();
    wallets = await connection.viem.getWalletClients();

    for (const wallet of wallets.slice(0, 6)) {
      assert.ok(wallet.account, "wallet account is available");
    }

    organizer = wallets[0].account!.address;
    memberA = wallets[1].account!.address;
    memberB = wallets[2].account!.address;
    memberC = wallets[3].account!.address;
    memberD = wallets[4].account!.address;
    outsider = wallets[5].account!.address;

    clients = await Promise.all(
      wallets.slice(0, 6).map((wallet) =>
        createViemHandleClient(scopedWallet(wallet), {
          smartContractAddress: NOX_COMPUTE_ADDRESS,
          gatewayUrl: handleGatewayUrl(),
          subgraphUrl: "https://example.com/subgraphs/id/none",
        }),
      ),
    );

    fairCircle = await connection.viem.deployContract("FairCircle");
  });

  it("creates a valid equal-split room", async () => {
    const roomId = await createEqualRoom({ totalCost: 99n });
    const room = await getRoom(roomId);

    assert.equal(room.title, "Equal dinner");
    assert.equal(room.organizer.toLowerCase(), organizer.toLowerCase());
    assert.equal(room.mode, RoomMode.FairSplit);
    assert.equal(room.status, RoomStatus.Finalized);
    assert.equal(await fairCircle.read.getSplitMethod([roomId]), SplitMethod.Equal);
    assert.equal(await fairCircle.read.getSplitTotalCost([roomId]), 99n);
    assert.equal(await fairCircle.read.sharesReady([roomId]), true);
  });

  it("creates a valid weighted-split room", async () => {
    const roomId = await createWeightedRoom({ totalCost: 300n });
    const room = await getRoom(roomId);

    assert.equal(room.mode, RoomMode.FairSplit);
    assert.equal(room.status, RoomStatus.CollectingInputs);
    assert.equal(await fairCircle.read.getSplitMethod([roomId]), SplitMethod.CapacityWeighted);
    assert.equal(await fairCircle.read.getSplitTotalCost([roomId]), 300n);
    assert.equal(await fairCircle.read.sharesReady([roomId]), false);
  });

  it("rejects invalid member counts", async () => {
    await assert.rejects(
      createEqualRoom({ members: [memberA] }),
      /InvalidMemberCount|revert/i,
    );
    await assert.rejects(
      createEqualRoom({
        members: [
          wallets[0].account!.address,
          wallets[1].account!.address,
          wallets[2].account!.address,
          wallets[3].account!.address,
          wallets[4].account!.address,
          wallets[5].account!.address,
          wallets[6].account!.address,
          wallets[7].account!.address,
          wallets[8].account!.address,
        ],
      }),
      /InvalidMemberCount|revert/i,
    );
  });

  it("rejects duplicate members", async () => {
    await assert.rejects(
      createWeightedRoom({ members: [memberA, memberB, memberA] }),
      /DuplicateMember|revert/i,
    );
  });

  it("rejects zero member addresses", async () => {
    await assert.rejects(
      createWeightedRoom({
        members: [memberA, "0x0000000000000000000000000000000000000000", memberB],
      }),
      /InvalidMember|revert/i,
    );
  });

  it("rejects zero total cost", async () => {
    await assert.rejects(createEqualRoom({ totalCost: 0n }), /InvalidTotalCost|revert/i);
  });

  it("rejects invalid deadlines", async () => {
    const deadline = BigInt((await latestTimestamp()) - 1);
    await assert.rejects(
      createWeightedRoom({ deadline }),
      /InvalidDeadline|revert/i,
    );
  });

  it("rejects FairSplit calls for QuietBudget rooms", async () => {
    const roomId = await createQuietBudgetRoom();
    const input = await encryptedInput(1, 40n);

    await assert.rejects(
      fairCircle.write.submitSplitCapacity([roomId, input.handle, input.handleProof], {
        account: memberA,
      }),
      /WrongRoomMode|revert/i,
    );
    await assert.rejects(
      fairCircle.read.getSplitTotalCost([roomId]),
      /WrongRoomMode|revert/i,
    );
  });

  it("enforces cancellation rules", async () => {
    const equalRoomId = await createEqualRoom();
    await assert.rejects(
      fairCircle.write.cancelRoom([equalRoomId]),
      /CancellationClosed|revert/i,
    );

    const weightedRoomId = await createWeightedRoom();
    await fairCircle.write.cancelRoom([weightedRoomId]);
    assert.equal((await getRoom(weightedRoomId)).status, RoomStatus.Cancelled);

    const readyRoomId = await evaluatedWeightedRoom();
    await assert.rejects(
      fairCircle.write.cancelRoom([readyRoomId]),
      /CancellationClosed|revert/i,
    );
  });

  it("calculates exact equal split shares", async () => {
    const roomId = await createEqualRoom({ totalCost: 90n });

    assert.deepEqual(await decryptShares(roomId, [1, 2, 3]), [30n, 30n, 30n]);
  });

  it("calculates equal split shares with a remainder", async () => {
    const roomId = await createEqualRoom({ totalCost: 100n });

    assert.deepEqual(await decryptShares(roomId, [1, 2, 3]), [34n, 33n, 33n]);
  });

  it("assigns equal-split remainder to the first member", async () => {
    const roomId = await createEqualRoom({ totalCost: 100n });

    assert.equal(
      normalize(await fairCircle.read.getRoundingRecipient([roomId])),
      normalize(memberA),
    );
    assert.equal(await decryptShare(roomId, 1), 34n);
  });

  it("marks equal-split shares ready immediately", async () => {
    const roomId = await createEqualRoom();

    assert.equal(await fairCircle.read.sharesReady([roomId]), true);
    assert.equal((await getRoom(roomId)).status, RoomStatus.Finalized);
  });

  it("rejects capacity submissions for equal split rooms", async () => {
    const roomId = await createEqualRoom();
    const input = await encryptedInput(1, 40n);

    await assert.rejects(
      fairCircle.write.submitSplitCapacity([roomId, input.handle, input.handleProof], {
        account: memberA,
      }),
      /SplitCapacitySubmissionNotAllowed|revert/i,
    );
  });

  it("lets each equal-split member decrypt their own share", async () => {
    const roomId = await createEqualRoom({ totalCost: 90n });

    assert.equal(await decryptShare(roomId, 1), 30n);
    assert.equal(await decryptShare(roomId, 2), 30n);
    assert.equal(await decryptShare(roomId, 3), 30n);
  });

  it("prevents outsiders from decrypting equal-split shares", async () => {
    const roomId = await createEqualRoom({ totalCost: 90n });
    const share = await shareHandle(roomId, memberA);

    await assert.rejects(clients[5].decrypt(share), /not authorized|decrypt/i);
  });

  it("prevents the organizer from decrypting another equal-split member's share", async () => {
    const roomId = await createEqualRoom({ totalCost: 90n });
    const share = await shareHandle(roomId, memberA);

    await assert.rejects(clients[0].decrypt(share), /not authorized|decrypt/i);
  });

  it("keeps equal-split decrypted shares equal to the total cost", async () => {
    const total = 100n;
    const roomId = await createEqualRoom({ totalCost: total });
    const shares = await decryptShares(roomId, [1, 2, 3]);

    assert.equal(sum(shares), total);
  });

  it("rejects outsider weighted capacity submissions", async () => {
    const roomId = await createWeightedRoom();
    const input = await encryptedInput(5, 100n);

    await assert.rejects(
      fairCircle.write.submitSplitCapacity([roomId, input.handle, input.handleProof], {
        account: outsider,
      }),
      /NotMember|revert/i,
    );
  });

  it("allows each weighted member to submit once", async () => {
    const roomId = await createWeightedRoom();
    await submitSplit(roomId, 1, 40n);

    await assert.rejects(submitSplit(roomId, 1, 41n), /AlreadySubmitted|revert/i);
  });

  it("enforces weighted submission deadlines", async () => {
    const deadline = BigInt((await latestTimestamp()) + 120);
    const roomId = await createWeightedRoom({ deadline });

    await increaseTime(121);

    await assert.rejects(submitSplit(roomId, 1, 40n), /SubmissionClosed|revert/i);
  });

  it("restores weighted capacity ACL to the submitter and contract only", async () => {
    const roomId = await createWeightedRoom();
    await submitSplit(roomId, 1, 40n);

    assert.equal(await fairCircle.read.isCapacityAllowed([roomId, memberA, memberA]), true);
    assert.equal(
      await fairCircle.read.isCapacityAllowed([roomId, memberA, fairCircle.address]),
      true,
    );
    assert.equal(await fairCircle.read.isCapacityAllowed([roomId, memberA, organizer]), false);

    const capacity = await splitCapacityHandleFor(roomId, 1);
    assert.equal((await clients[1].decrypt(capacity)).value, 40n);
  });

  it("prevents organizer from decrypting another weighted member's capacity", async () => {
    const roomId = await createWeightedRoom();
    await submitSplit(roomId, 1, 40n);

    await assert.rejects(
      clients[0].decrypt(await splitCapacityHandleFor(roomId, 1)),
      /not authorized|decrypt/i,
    );
  });

  it("keeps weighted aggregate contract-only", async () => {
    const roomId = await createWeightedRoom();
    await submitSplit(roomId, 1, 40n);

    assert.equal(await fairCircle.read.isAggregateAllowed([roomId, fairCircle.address]), true);
    assert.equal(await fairCircle.read.isAggregateAllowed([roomId, memberA]), false);
    assert.equal(await fairCircle.read.isAggregateAllowed([roomId, organizer]), false);
  });

  it("automatically evaluates weighted feasibility after final submission", async () => {
    const roomId = await evaluatedWeightedRoom();

    assert.equal((await getRoom(roomId)).status, RoomStatus.ReadyForDecryption);
    assert.notEqual(await feasibilityHandle(roomId), zeroHandle());
  });

  it("marks weighted feasibility handle publicly decryptable", async () => {
    const roomId = await evaluatedWeightedRoom();

    assert.equal(await fairCircle.read.isSplitFeasibilityPubliclyDecryptable([roomId]), true);
    assert.equal(
      await fairCircle.read.isSplitFeasibilityAllowed([roomId, fairCircle.address]),
      true,
    );
  });

  it("rejects invalid weighted feasibility public-decryption proofs", async () => {
    const roomId = await evaluatedWeightedRoom();

    await assert.rejects(
      fairCircle.write.finalizeSplitFeasibility([roomId, "0x1234"]),
      /revert|Malformed|proof|decrypt/i,
    );
  });

  it("does not create shares for unaffordable weighted splits", async () => {
    const roomId = await createWeightedRoom({ totalCost: 300n });
    await submitSplit(roomId, 1, 40n);
    await submitSplit(roomId, 2, 50n);
    await submitSplit(roomId, 3, 60n);
    await finalizeWeighted(roomId);

    assert.deepEqual(await fairCircle.read.getPublicSplitFeasibility([roomId]), [
      true,
      false,
    ]);
    assert.equal(await fairCircle.read.sharesReady([roomId]), false);
    await assert.rejects(
      fairCircle.read.getMyShareHandle([roomId], { account: memberA }),
      /SharesNotReady|revert/i,
    );
  });

  it("calculates affordable weighted shares", async () => {
    const roomId = await weightedExampleRoom();

    assert.deepEqual(await decryptShares(roomId, [1, 2, 3, 4]), [
      30n,
      60n,
      75n,
      135n,
    ]);
  });

  it("assigns weighted rounding remainder to the first member", async () => {
    const roomId = await createWeightedRoom({
      members: [memberA, memberB, memberC],
      totalCost: 101n,
    });
    await submitSplit(roomId, 1, 100n);
    await submitSplit(roomId, 2, 100n);
    await submitSplit(roomId, 3, 100n);
    await finalizeWeighted(roomId);

    assert.equal(
      normalize(await fairCircle.read.getRoundingRecipient([roomId])),
      normalize(memberA),
    );
    assert.deepEqual(await decryptShares(roomId, [1, 2, 3]), [35n, 33n, 33n]);
  });

  it("lets every weighted member decrypt only their own share", async () => {
    const roomId = await weightedExampleRoom();

    for (let i = 1; i <= 4; i += 1) {
      const own = await fairCircle.read.getMyShareHandle([roomId], {
        account: wallets[i].account!.address,
      });
      assert.equal((await clients[i].decrypt(own as Hex)).solidityType, "uint256");

      const nextMember = i === 4 ? memberA : wallets[i + 1].account!.address;
      await assert.rejects(
        clients[i].decrypt(await shareHandle(roomId, nextMember)),
        /not authorized|decrypt/i,
      );
    }
  });

  it("prevents outsiders from decrypting weighted shares", async () => {
    const roomId = await weightedExampleRoom();

    for (const member of [memberA, memberB, memberC, memberD]) {
      await assert.rejects(
        clients[5].decrypt(await shareHandle(roomId, member)),
        /not authorized|decrypt/i,
      );
    }
  });

  it("keeps weighted decrypted shares equal to total cost", async () => {
    const roomId = await weightedExampleRoom();
    const shares = await decryptShares(roomId, [1, 2, 3, 4]);

    assert.equal(sum(shares), 300n);
  });

  it("restores weighted share ACL", async () => {
    const roomId = await weightedExampleRoom();

    assert.equal(await fairCircle.read.isShareAllowed([roomId, memberA, memberA]), true);
    assert.equal(
      await fairCircle.read.isShareAllowed([roomId, memberA, fairCircle.address]),
      true,
    );
    assert.equal(await fairCircle.read.isShareAllowed([roomId, memberA, organizer]), false);
  });

  it("rejects repeated weighted feasibility finalization", async () => {
    const roomId = await weightedExampleRoom();

    await assert.rejects(
      finalizeWeighted(roomId),
      /RoomNotReady|SplitFeasibilityAlreadyFinalized|revert/i,
    );
  });

  async function createEqualRoom({
    members = [memberA, memberB, memberC],
    totalCost = 90n,
    deadline,
  }: {
    members?: Address[];
    totalCost?: bigint;
    deadline?: bigint;
  } = {}) {
    return createFairSplitRoom({
      title: "Equal dinner",
      members,
      totalCost,
      deadline,
      splitMethod: SplitMethod.Equal,
    });
  }

  async function createWeightedRoom({
    members = [memberA, memberB, memberC],
    totalCost = 300n,
    deadline,
  }: {
    members?: Address[];
    totalCost?: bigint;
    deadline?: bigint;
  } = {}) {
    return createFairSplitRoom({
      title: "Weighted trip",
      members,
      totalCost,
      deadline,
      splitMethod: SplitMethod.CapacityWeighted,
    });
  }

  async function createFairSplitRoom({
    title,
    members,
    totalCost,
    deadline,
    splitMethod,
  }: {
    title: string;
    members: Address[];
    totalCost: bigint;
    deadline?: bigint;
    splitMethod: number;
  }) {
    const roomId = await fairCircle.read.nextRoomId();
    const actualDeadline = deadline ?? BigInt((await latestTimestamp()) + 3600);

    await fairCircle.write.createFairSplitRoom([
      title,
      members,
      totalCost,
      actualDeadline,
      splitMethod,
    ]);

    return roomId;
  }

  async function createQuietBudgetRoom() {
    const roomId = await fairCircle.read.nextRoomId();
    const deadline = BigInt((await latestTimestamp()) + 3600);
    await fairCircle.write.createQuietBudgetRoom([
      "Quiet",
      [memberA, memberB],
      [100n],
      deadline,
      RoomMode.QuietBudget,
    ]);
    return roomId;
  }

  async function evaluatedWeightedRoom() {
    const roomId = await createWeightedRoom();
    await submitSplit(roomId, 1, 40n);
    await submitSplit(roomId, 2, 80n);
    await submitSplit(roomId, 3, 100n);
    return roomId;
  }

  async function weightedExampleRoom() {
    const roomId = await createWeightedRoom({
      members: [memberA, memberB, memberC, memberD],
      totalCost: 300n,
    });
    await submitSplit(roomId, 1, 40n);
    await submitSplit(roomId, 2, 80n);
    await submitSplit(roomId, 3, 100n);
    await submitSplit(roomId, 4, 180n);
    await finalizeWeighted(roomId);
    return roomId;
  }

  async function encryptedInput(walletIndex: number, value: bigint) {
    return clients[walletIndex].encryptInput(value, "uint256", fairCircle.address);
  }

  async function submitSplit(roomId: bigint, walletIndex: number, value: bigint) {
    const input = await encryptedInput(walletIndex, value);
    await fairCircle.write.submitSplitCapacity(
      [roomId, input.handle, input.handleProof],
      { account: wallets[walletIndex].account!.address },
    );
  }

  async function finalizeWeighted(roomId: bigint) {
    const proof = await clients[0].publicDecrypt(await feasibilityHandle(roomId));
    await fairCircle.write.finalizeSplitFeasibility([roomId, proof.decryptionProof]);
  }

  async function splitCapacityHandleFor(roomId: bigint, walletIndex: number) {
    return fairCircle.read.getMySplitCapacityHandle([roomId], {
      account: wallets[walletIndex].account!.address,
    }) as Promise<Hex>;
  }

  async function shareHandle(roomId: bigint, member: Address) {
    return fairCircle.read.getShareHandleForTesting([roomId, member]) as Promise<Hex>;
  }

  async function decryptShare(roomId: bigint, walletIndex: number) {
    const handle = await fairCircle.read.getMyShareHandle([roomId], {
      account: wallets[walletIndex].account!.address,
    });
    return (await clients[walletIndex].decrypt(handle as Hex)).value as bigint;
  }

  async function decryptShares(roomId: bigint, walletIndexes: number[]) {
    const shares: bigint[] = [];
    for (const walletIndex of walletIndexes) {
      shares.push(await decryptShare(roomId, walletIndex));
    }
    return shares;
  }

  async function feasibilityHandle(roomId: bigint) {
    return fairCircle.read.getSplitFeasibilityHandle([roomId]) as Promise<Hex>;
  }

  async function getRoom(roomId: bigint) {
    return fairCircle.read.getRoom([roomId]) as Promise<{
      id: bigint;
      title: string;
      organizer: Address;
      mode: number;
      status: number;
      submissionDeadline: bigint;
      memberCount: number;
      submissionCount: number;
      optionCount: number;
      finalizedOptionCount: number;
    }>;
  }

  async function latestTimestamp() {
    const publicClient = await connection.viem.getPublicClient();
    const block = await publicClient.getBlock();
    return Number(block.timestamp);
  }

  async function increaseTime(seconds: number) {
    await connection.provider.request({
      method: "evm_increaseTime",
      params: [seconds],
    });
    await connection.provider.request({ method: "evm_mine" });
  }
});

function sum(values: bigint[]) {
  return values.reduce((total, value) => total + value, 0n);
}

function zeroHandle() {
  return `0x${"0".repeat(64)}`;
}

function normalize(address: Address) {
  return address.toLowerCase();
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
