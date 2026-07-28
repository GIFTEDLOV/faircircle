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
  PrivateCircle: 2,
  PlanTogether: 3,
} as const;

const RoomStatus = {
  CollectingInputs: 0,
  ReadyForDecryption: 1,
  Finalized: 2,
  Cancelled: 3,
} as const;

describe("FairCircle QuietBudget", () => {
  let connection: NoxConnection;
  let fairCircle: FairCircle;
  let wallets: WalletClient[];
  let clients: HandleClient[];
  let organizer: Address;
  let memberA: Address;
  let memberB: Address;
  let memberC: Address;
  let outsider: Address;

  beforeEach(async () => {
    connection = await nox.connect();
    wallets = await connection.viem.getWalletClients();

    for (const wallet of wallets.slice(0, 5)) {
      assert.ok(wallet.account, "wallet account is available");
    }

    organizer = wallets[0].account!.address;
    memberA = wallets[1].account!.address;
    memberB = wallets[2].account!.address;
    memberC = wallets[3].account!.address;
    outsider = wallets[4].account!.address;

    clients = await Promise.all(
      wallets.slice(0, 5).map((wallet) =>
        createViemHandleClient(scopedWallet(wallet), {
          smartContractAddress: NOX_COMPUTE_ADDRESS,
          gatewayUrl: handleGatewayUrl(),
          subgraphUrl: "https://example.com/subgraphs/id/none",
        }),
      ),
    );

    fairCircle = await connection.viem.deployContract("FairCircle");
  });

  it("creates a valid QuietBudget room", async () => {
    const roomId = await createRoom();

    const room = await getRoom(roomId);
    assert.equal(room.title, "Trip budget");
    assert.equal(room.organizer.toLowerCase(), organizer.toLowerCase());
    assert.equal(room.mode, RoomMode.QuietBudget);
    assert.equal(room.status, RoomStatus.CollectingInputs);
    assert.equal(room.memberCount, 3);
    assert.equal(room.optionCount, 3);
    assert.deepEqual((await fairCircle.read.getMembers([roomId])).map(normalize), [
      memberA,
      memberB,
      memberC,
    ].map(normalize));
    assert.deepEqual(await fairCircle.read.getOptions([roomId]), [
      150n,
      220n,
      250n,
    ]);
  });

  it("rejects invalid member counts", async () => {
    await assert.rejects(
      createRoom({ members: [memberA] }),
      /InvalidMemberCount|revert/i,
    );

    await assert.rejects(
      createRoom({
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
      createRoom({ members: [memberA, memberB, memberA] }),
      /DuplicateMember|revert/i,
    );
  });

  it("rejects invalid options", async () => {
    await assert.rejects(createRoom({ options: [] }), /InvalidOptionCount|revert/i);
    await assert.rejects(
      createRoom({ options: [150n, 0n] }),
      /InvalidOptionCost|revert/i,
    );
    await assert.rejects(
      createRoom({ options: [150n, 150n] }),
      /DuplicateOptionCost|revert/i,
    );
    await assert.rejects(
      createRoom({ options: [100n, 200n, 300n, 400n, 500n] }),
      /InvalidOptionCount|revert/i,
    );
  });

  it("rejects expired deadlines at creation", async () => {
    const deadline = BigInt((await latestTimestamp()) - 1);

    await assert.rejects(
      createRoom({ deadline }),
      /InvalidDeadline|revert/i,
    );
  });

  it("rejects outsider submissions", async () => {
    const roomId = await createRoom();
    const input = await encryptedInput(4, 50n);

    await assert.rejects(
      fairCircle.write.submitPrivateCapacity([roomId, input.handle, input.handleProof], {
        account: outsider,
      }),
      /NotMember|revert/i,
    );
  });

  it("allows each member to submit once", async () => {
    const roomId = await createRoom();
    await submit(roomId, 1, 40n);

    await assert.rejects(submit(roomId, 1, 41n), /AlreadySubmitted|revert/i);
  });

  it("restores individual capacity ACL to the submitter and contract only", async () => {
    const roomId = await createRoom();
    await submit(roomId, 1, 40n);

    assert.equal(await fairCircle.read.isCapacityAllowed([roomId, memberA, memberA]), true);
    assert.equal(
      await fairCircle.read.isCapacityAllowed([roomId, memberA, fairCircle.address]),
      true,
    );
    assert.equal(
      await fairCircle.read.isCapacityAllowed([roomId, memberA, organizer]),
      false,
    );

    const capacityHandle = await capacityHandleFor(roomId, 1);
    const decrypted = await clients[1].decrypt(capacityHandle);
    assert.equal(decrypted.value, 40n);
  });

  it("prevents the organizer from decrypting another member's capacity", async () => {
    const roomId = await createRoom();
    await submit(roomId, 1, 40n);

    const capacityHandle = await capacityHandleFor(roomId, 1);
    await assert.rejects(
      clients[0].decrypt(capacityHandle),
      /not authorized|does not exist|decrypt/i,
    );
  });

  it("updates the encrypted aggregate correctly for affordability evaluation", async () => {
    const roomId = await createRoom({
      members: [memberA, memberB],
      options: [100n, 130n],
    });

    await submit(roomId, 1, 40n);
    await submit(roomId, 2, 80n);
    await finalizeAll(roomId);

    assert.deepEqual(await publicResults(roomId, 2), [true, false]);
  });

  it("automatically evaluates encrypted affordability after the last submission", async () => {
    const roomId = await createRoom();
    await submit(roomId, 1, 40n);
    await submit(roomId, 2, 80n);

    assert.equal((await getRoom(roomId)).status, RoomStatus.CollectingInputs);
    await submit(roomId, 3, 100n);

    const room = await getRoom(roomId);
    assert.equal(room.status, RoomStatus.ReadyForDecryption);
    for (let i = 0; i < 3; i += 1) {
      assert.notEqual(await affordabilityHandle(roomId, i), zeroHandle());
    }
  });

  it("computes the documented affordability example", async () => {
    const roomId = await createRoom();
    await submit(roomId, 1, 40n);
    await submit(roomId, 2, 80n);
    await submit(roomId, 3, 100n);
    await finalizeAll(roomId);

    assert.deepEqual(await publicResults(roomId, 3), [true, true, false]);
  });

  it("marks affordability handles publicly decryptable", async () => {
    const roomId = await evaluatedRoom();

    for (let i = 0; i < 3; i += 1) {
      assert.equal(
        await fairCircle.read.isAffordabilityPubliclyDecryptable([roomId, BigInt(i)]),
        true,
      );
    }
  });

  it("finalizes affordability with valid public-decryption proofs", async () => {
    const roomId = await evaluatedRoom();
    const proof = await publicProof(roomId, 0);

    await fairCircle.write.finalizeAffordability([roomId, 0n, proof.decryptionProof], {
      account: outsider,
    });

    assert.deepEqual(await fairCircle.read.getPublicAffordability([roomId, 0n]), [
      true,
      true,
    ]);
  });

  it("rejects invalid public-decryption proofs", async () => {
    const roomId = await evaluatedRoom();
    const proofForOptionZero = await publicProof(roomId, 0);

    await assert.rejects(
      fairCircle.write.finalizeAffordability([
        roomId,
        1n,
        proofForOptionZero.decryptionProof,
      ]),
      /revert|Malformed|proof|decrypt/i,
    );
  });

  it("finalizes the room only after every option result is finalized", async () => {
    const roomId = await evaluatedRoom({ options: [150n, 220n] });

    await finalizeOption(roomId, 0);
    assert.equal((await getRoom(roomId)).status, RoomStatus.ReadyForDecryption);

    await finalizeOption(roomId, 1);
    const room = await getRoom(roomId);
    assert.equal(room.status, RoomStatus.Finalized);
    assert.equal(room.finalizedOptionCount, 2);
  });

  it("allows the organizer to cancel before encrypted evaluation begins", async () => {
    const roomId = await createRoom();

    await fairCircle.write.cancelRoom([roomId]);

    assert.equal((await getRoom(roomId)).status, RoomStatus.Cancelled);
  });

  it("rejects non-organizer cancellation", async () => {
    const roomId = await createRoom();

    await assert.rejects(
      fairCircle.write.cancelRoom([roomId], { account: memberA }),
      /NotOrganizer|revert/i,
    );
  });

  it("rejects submission after cancellation", async () => {
    const roomId = await createRoom();
    await fairCircle.write.cancelRoom([roomId]);

    await assert.rejects(submit(roomId, 1, 40n), /RoomNotCollecting|revert/i);
  });

  it("rejects submissions at or after the deadline", async () => {
    const deadline = BigInt((await latestTimestamp()) + 120);
    const roomId = await createRoom({ deadline });

    await increaseTime(121);

    await assert.rejects(submit(roomId, 1, 40n), /SubmissionClosed|revert/i);
  });

  it("restores ACL for aggregate and affordability handles", async () => {
    const roomId = await createRoom();
    await submit(roomId, 1, 40n);

    assert.equal(await fairCircle.read.isAggregateAllowed([roomId, fairCircle.address]), true);
    assert.equal(await fairCircle.read.isAggregateAllowed([roomId, organizer]), false);
    assert.equal(await fairCircle.read.isAggregateAllowed([roomId, memberA]), false);

    await submit(roomId, 2, 80n);
    await submit(roomId, 3, 100n);

    for (let i = 0; i < 3; i += 1) {
      assert.equal(
        await fairCircle.read.isAffordabilityAllowed([
          roomId,
          BigInt(i),
          fairCircle.address,
        ]),
        true,
      );
      assert.equal(
        await fairCircle.read.isAffordabilityPubliclyDecryptable([roomId, BigInt(i)]),
        true,
      );
    }
  });

  async function createRoom({
    members = [memberA, memberB, memberC],
    options = [150n, 220n, 250n],
    deadline,
    mode = RoomMode.QuietBudget,
  }: {
    members?: Address[];
    options?: bigint[];
    deadline?: bigint;
    mode?: number;
  } = {}) {
    const roomId = await fairCircle.read.nextRoomId();
    const actualDeadline = deadline ?? BigInt((await latestTimestamp()) + 3600);

    await fairCircle.write.createQuietBudgetRoom([
      "Trip budget",
      members,
      options,
      actualDeadline,
      mode,
    ]);

    return roomId;
  }

  async function evaluatedRoom(overrides: { options?: bigint[] } = {}) {
    const roomId = await createRoom(overrides);
    await submit(roomId, 1, 40n);
    await submit(roomId, 2, 80n);
    await submit(roomId, 3, 100n);
    return roomId;
  }

  async function encryptedInput(walletIndex: number, value: bigint) {
    return clients[walletIndex].encryptInput(value, "uint256", fairCircle.address);
  }

  async function submit(roomId: bigint, walletIndex: number, value: bigint) {
    const input = await encryptedInput(walletIndex, value);
    await fairCircle.write.submitPrivateCapacity(
      [roomId, input.handle, input.handleProof],
      { account: wallets[walletIndex].account!.address },
    );
  }

  async function capacityHandleFor(roomId: bigint, walletIndex: number) {
    return fairCircle.read.getMyCapacityHandle([roomId], {
      account: wallets[walletIndex].account!.address,
    }) as Promise<Hex>;
  }

  async function affordabilityHandle(roomId: bigint, optionIndex: number) {
    return fairCircle.read.getAffordabilityHandle([
      roomId,
      BigInt(optionIndex),
    ]) as Promise<Hex>;
  }

  async function publicProof(roomId: bigint, optionIndex: number) {
    return clients[0].publicDecrypt(await affordabilityHandle(roomId, optionIndex));
  }

  async function finalizeOption(roomId: bigint, optionIndex: number) {
    const proof = await publicProof(roomId, optionIndex);
    await fairCircle.write.finalizeAffordability([
      roomId,
      BigInt(optionIndex),
      proof.decryptionProof,
    ]);
  }

  async function finalizeAll(roomId: bigint) {
    const optionCount = Number((await getRoom(roomId)).optionCount);
    for (let i = 0; i < optionCount; i += 1) {
      await finalizeOption(roomId, i);
    }
  }

  async function publicResults(roomId: bigint, optionCount: number) {
    const results: boolean[] = [];
    for (let i = 0; i < optionCount; i += 1) {
      const [, affordable] = await fairCircle.read.getPublicAffordability([
        roomId,
        BigInt(i),
      ]);
      results.push(affordable);
    }
    return results;
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
