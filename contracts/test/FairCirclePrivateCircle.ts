import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";
import {
  handleGatewayUrl,
  NOX_COMPUTE_ADDRESS,
  nox,
} from "@iexec-nox/nox-hardhat-plugin";
import { encodeAbiParameters, type Address, type Hex, type WalletClient } from "viem";

type NoxConnection = Awaited<ReturnType<typeof nox.connect>>;
type DeployedContract = Awaited<ReturnType<NoxConnection["viem"]["deployContract"]>>;

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

const CollectionAccess = {
  Open: 0,
  InviteOnly: 1,
} as const;

const CollectionStatus = {
  Open: 0,
  Closed: 1,
  WithdrawalPending: 2,
  Withdrawn: 3,
  Cancelled: 4,
} as const;

describe("FairCircle PrivateCircle", () => {
  let connection: NoxConnection;
  let fairCircle: DeployedContract;
  let testUsd: DeployedContract;
  let confidentialUsd: DeployedContract;
  let wallets: WalletClient[];
  let clients: HandleClient[];
  let organizer: Address;
  let memberA: Address;
  let memberB: Address;
  let memberC: Address;
  let outsider: Address;
  let recipient: Address;

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
    outsider = wallets[4].account!.address;
    recipient = wallets[5].account!.address;

    clients = await Promise.all(
      wallets.slice(0, 6).map((wallet) =>
        createViemHandleClient(scopedWallet(wallet), {
          smartContractAddress: NOX_COMPUTE_ADDRESS,
          gatewayUrl: handleGatewayUrl(),
          subgraphUrl: "https://example.com/subgraphs/id/none",
        }),
      ),
    );

    testUsd = await connection.viem.deployContract("TestUSD");
    confidentialUsd = await connection.viem.deployContract("FairCircleUSD", [
      testUsd.address,
    ]);
    fairCircle = await connection.viem.deployContract("FairCircle");

    await fundConfidentialUsd(memberA, 500n);
    await fundConfidentialUsd(memberB, 500n);
    await fundConfidentialUsd(memberC, 500n);
    await fundConfidentialUsd(outsider, 500n);
  });

  it("creates an invite-only Private Circle room", async () => {
    const deadline = await futureDeadline();
    const roomId = await createPrivateCircleRoom({ deadline, target: 120n });
    const room = await getRoom(roomId);
    const circle = await getPrivateCircle(roomId);

    assert.equal(room.title, "Trip collection");
    assert.equal(room.organizer.toLowerCase(), organizer.toLowerCase());
    assert.equal(room.mode, RoomMode.PrivateCircle);
    assert.equal(room.status, RoomStatus.CollectingInputs);
    assert.equal(room.memberCount, 3);
    assert.deepEqual((await fairCircle.read.getMembers([roomId])).map(normalize), [
      memberA,
      memberB,
      memberC,
    ].map(normalize));

    assert.equal(circle.confidentialToken.toLowerCase(), confidentialUsd.address.toLowerCase());
    assert.equal(circle.recipient.toLowerCase(), recipient.toLowerCase());
    assert.equal(circle.publicTarget, 120n);
    assert.equal(circle.deadline, deadline);
    assert.equal(circle.access, CollectionAccess.InviteOnly);
    assert.equal(circle.collectionStatus, CollectionStatus.Open);
    assert.equal(circle.verifiedContributionCount, 0n);
    assert.equal(circle.uniqueContributorCount, 0n);
  });

  it("rejects invalid Private Circle creation inputs", async () => {
    const deadline = await futureDeadline();

    await assert.rejects(
      createPrivateCircleRoom({
        token: testUsd.address,
        deadline,
      }),
      /InvalidToken|revert/i,
    );
    await assert.rejects(
      createPrivateCircleRoom({
        recipientAddress: "0x0000000000000000000000000000000000000000",
        deadline,
      }),
      /InvalidRecipient|revert/i,
    );
    await assert.rejects(
      createPrivateCircleRoom({
        members: [memberA],
        deadline,
      }),
      /InvalidCollectionMembers|revert/i,
    );
    await assert.rejects(
      createPrivateCircleRoom({
        access: CollectionAccess.Open,
        members: [memberA, memberB],
        deadline,
      }),
      /InvalidCollectionMembers|revert/i,
    );
  });

  it("accepts confidential contributions and exposes only authorized handles", async () => {
    const roomId = await createPrivateCircleRoom({ target: 120n });

    const contributionA = await contribute(roomId, 1, 50n);
    const contributionB = await contribute(roomId, 2, 70n);

    assert.equal(await fairCircle.read.isCollectionAggregateAllowed([roomId, organizer]), true);
    assert.equal(
      await fairCircle.read.isCollectionAggregateAllowed([roomId, fairCircle.address]),
      true,
    );
    assert.equal(await fairCircle.read.isCollectionAggregateAllowed([roomId, memberA]), false);
    assert.equal(
      await fairCircle.read.isContributionReceiptAllowed([contributionA, memberA]),
      true,
    );
    assert.equal(
      await fairCircle.read.isContributionReceiptAllowed([contributionA, organizer]),
      false,
    );
    assert.equal(
      await fairCircle.read.isCumulativeContributionAllowed([roomId, memberA, memberA]),
      true,
    );

    await assert.rejects(
      clients[0].decrypt(await contributionHandle(contributionA, 1)),
      /not authorized|decrypt/i,
    );

    assert.equal((await clients[1].decrypt(await contributionHandle(contributionA, 1))).value, 50n);
    assert.equal((await clients[2].decrypt(await contributionHandle(contributionB, 2))).value, 70n);
    assert.equal((await clients[1].decrypt(await cumulativeHandle(roomId, 1))).value, 50n);
  });

  it("finalizes contribution counts without revealing amounts", async () => {
    const roomId = await createPrivateCircleRoom({ target: 120n });
    const contributionA = await contribute(roomId, 1, 50n);
    const contributionB = await contribute(roomId, 2, 70n);
    const contributionA2 = await contribute(roomId, 1, 5n);

    await finalizeContribution(contributionA);
    await finalizeContribution(contributionB);
    await finalizeContribution(contributionA2);

    const circle = await getPrivateCircle(roomId);
    assert.equal(circle.verifiedContributionCount, 3n);
    assert.equal(circle.uniqueContributorCount, 2n);
    assert.equal(await fairCircle.read.hasVerifiedContribution([roomId, memberA]), true);
    assert.equal(await fairCircle.read.hasVerifiedContribution([roomId, memberB]), true);
    assert.equal(await fairCircle.read.hasVerifiedContribution([roomId, memberC]), false);

    await assert.rejects(
      finalizeContribution(contributionA),
      /ContributionAlreadyFinalized|revert/i,
    );
  });

  it("updates and finalizes public target status per contribution version", async () => {
    const roomId = await createPrivateCircleRoom({ target: 120n });

    await contribute(roomId, 1, 50n);
    assert.equal(await fairCircle.read.getCollectionTargetVersion([roomId]), 1n);
    assert.equal(await fairCircle.read.isCollectionTargetPubliclyDecryptable([roomId]), true);
    await finalizeTarget(roomId);
    assert.deepEqual(await publicTargetStatus(roomId), {
      finalized: true,
      reached: false,
      version: 1n,
    });

    await contribute(roomId, 2, 70n);
    assert.deepEqual(await publicTargetStatus(roomId), {
      finalized: false,
      reached: false,
      version: 2n,
    });
    await finalizeTarget(roomId);
    assert.deepEqual(await publicTargetStatus(roomId), {
      finalized: true,
      reached: true,
      version: 2n,
    });
  });

  it("enforces invite-only membership and collection lifecycle", async () => {
    const roomId = await createPrivateCircleRoom();

    await assert.rejects(
      contribute(roomId, 4, 20n),
      /NotMember|revert/i,
    );
    await assert.rejects(
      fairCircle.write.closePrivateCircle([roomId], { account: memberA }),
      /NotOrganizer|revert/i,
    );

    await fairCircle.write.closePrivateCircle([roomId]);
    assert.equal((await getPrivateCircle(roomId)).collectionStatus, CollectionStatus.Closed);

    await assert.rejects(
      contribute(roomId, 1, 20n),
      /CollectionNotOpen|revert/i,
    );
  });

  it("allows open collections without invited members", async () => {
    const roomId = await createPrivateCircleRoom({
      access: CollectionAccess.Open,
      members: [],
      target: 0n,
    });

    await contribute(roomId, 4, 25n);
    const contribution = await fairCircle.read.getContribution([1n]);

    assert.equal(contribution.contributor.toLowerCase(), outsider.toLowerCase());
    assert.equal((await getPrivateCircle(roomId)).access, CollectionAccess.Open);
  });

  it("cancels only before contributions arrive", async () => {
    const emptyRoomId = await createPrivateCircleRoom();
    await fairCircle.write.cancelRoom([emptyRoomId]);
    assert.equal((await getRoom(emptyRoomId)).status, RoomStatus.Cancelled);
    assert.equal((await getPrivateCircle(emptyRoomId)).collectionStatus, CollectionStatus.Cancelled);

    const fundedRoomId = await createPrivateCircleRoom();
    await contribute(fundedRoomId, 1, 10n);
    await assert.rejects(
      fairCircle.write.cancelRoom([fundedRoomId]),
      /CollectionHasContributions|revert/i,
    );
  });

  it("withdraws the confidential aggregate to the recipient after verified contribution", async () => {
    const roomId = await createPrivateCircleRoom({ target: 120n });
    const contributionA = await contribute(roomId, 1, 50n);
    const contributionB = await contribute(roomId, 2, 70n);
    await finalizeContribution(contributionA);
    await finalizeContribution(contributionB);

    await fairCircle.write.closePrivateCircle([roomId]);
    await fairCircle.write.requestCollectionWithdrawal([roomId]);
    assert.equal(
      (await getPrivateCircle(roomId)).collectionStatus,
      CollectionStatus.WithdrawalPending,
    );
    assert.equal(await fairCircle.read.isWithdrawalSuccessPubliclyDecryptable([roomId]), true);

    const withdrawalSuccess = await clients[0].publicDecrypt(
      (await fairCircle.read.getWithdrawalSuccessHandle([roomId])) as Hex,
    );
    assert.equal(withdrawalSuccess.value, true);
    await fairCircle.write.finalizeCollectionWithdrawal([
      roomId,
      withdrawalSuccess.decryptionProof,
    ]);

    assert.equal((await getRoom(roomId)).status, RoomStatus.Finalized);
    assert.equal((await getPrivateCircle(roomId)).collectionStatus, CollectionStatus.Withdrawn);
    assert.equal((await clients[5].decrypt(await withdrawalHandle(roomId))).value, 120n);
  });

  it("requires at least one finalized positive contribution before withdrawal", async () => {
    const roomId = await createPrivateCircleRoom();
    await contribute(roomId, 1, 30n);
    await fairCircle.write.closePrivateCircle([roomId]);

    await assert.rejects(
      fairCircle.write.requestCollectionWithdrawal([roomId]),
      /ZeroContributionCollection|revert/i,
    );
  });

  async function createPrivateCircleRoom({
    token = confidentialUsd.address,
    recipientAddress = recipient,
    target = 0n,
    deadline,
    access = CollectionAccess.InviteOnly,
    members = [memberA, memberB, memberC],
  }: {
    token?: Address;
    recipientAddress?: Address;
    target?: bigint;
    deadline?: bigint;
    access?: number;
    members?: Address[];
  } = {}) {
    const roomId = await fairCircle.read.nextRoomId();
    const actualDeadline = deadline ?? await futureDeadline();

    await fairCircle.write.createPrivateCircleRoom([
      "Trip collection",
      token,
      recipientAddress,
      target,
      actualDeadline,
      access,
      members,
    ]);

    return roomId;
  }

  async function fundConfidentialUsd(account: Address, amount: bigint) {
    await testUsd.write.mint([account, amount]);
    await testUsd.write.approve([confidentialUsd.address, amount], { account });
    await confidentialUsd.write.wrap([account, amount], { account });
  }

  async function contribute(roomId: bigint, walletIndex: number, amount: bigint) {
    const contributionId = await fairCircle.read.nextContributionId();
    const input = await clients[walletIndex].encryptInput(
      amount,
      "uint256",
      confidentialUsd.address,
    );

    await confidentialUsd.write.confidentialTransferAndCall(
      [fairCircle.address, input.handle, input.handleProof, roomData(roomId)],
      { account: wallets[walletIndex].account!.address },
    );

    return contributionId;
  }

  async function finalizeContribution(contributionId: bigint) {
    const proof = await clients[0].publicDecrypt(
      (await fairCircle.read.getContributionPositivityHandle([contributionId])) as Hex,
    );

    await fairCircle.write.finalizeContribution([
      contributionId,
      proof.decryptionProof,
    ]);
  }

  async function finalizeTarget(roomId: bigint) {
    const proof = await clients[0].publicDecrypt(
      (await fairCircle.read.getCollectionTargetHandle([roomId])) as Hex,
    );

    await fairCircle.write.finalizeCollectionTarget([
      roomId,
      proof.decryptionProof,
    ]);
  }

  async function publicTargetStatus(roomId: bigint) {
    const [finalized, reached, version] = await fairCircle.read.getPublicTargetStatus([roomId]);
    return { finalized, reached, version };
  }

  async function contributionHandle(contributionId: bigint, walletIndex: number) {
    return fairCircle.read.getMyContributionHandle([contributionId], {
      account: wallets[walletIndex].account!.address,
    }) as Promise<Hex>;
  }

  async function cumulativeHandle(roomId: bigint, walletIndex: number) {
    return fairCircle.read.getMyCumulativeContributionHandle([roomId], {
      account: wallets[walletIndex].account!.address,
    }) as Promise<Hex>;
  }

  async function withdrawalHandle(roomId: bigint) {
    return fairCircle.read.getWithdrawalHandle([roomId]) as Promise<Hex>;
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

  async function getPrivateCircle(roomId: bigint) {
    return fairCircle.read.getPrivateCircle([roomId]) as Promise<{
      id: bigint;
      title: string;
      organizer: Address;
      confidentialToken: Address;
      recipient: Address;
      publicTarget: bigint;
      deadline: bigint;
      access: number;
      collectionStatus: number;
      verifiedContributionCount: bigint;
      uniqueContributorCount: bigint;
      targetVersion: bigint;
    }>;
  }

  async function futureDeadline() {
    const publicClient = await connection.viem.getPublicClient();
    return (await publicClient.getBlock()).timestamp + 3600n;
  }
});

function roomData(roomId: bigint) {
  return encodeAbiParameters([{ type: "uint256" }], [roomId]);
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
