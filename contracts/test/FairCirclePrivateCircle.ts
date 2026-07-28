import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const MAX_SUPPORTED_AMOUNT = 10n ** 36n;

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

    for (const wallet of wallets.slice(0, 10)) {
      assert.ok(wallet.account, "wallet account is available");
    }

    organizer = requireAccount(wallets[0]);
    memberA = requireAccount(wallets[1]);
    memberB = requireAccount(wallets[2]);
    memberC = requireAccount(wallets[3]);
    outsider = requireAccount(wallets[4]);
    recipient = requireAccount(wallets[5]);

    clients = await Promise.all(
      wallets.slice(0, 10).map((wallet) =>
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

    for (const account of [memberA, memberB, memberC, outsider]) {
      await fundConfidentialUsd(account, 500n);
    }
  });

  describe("token wrapper", () => {
    it("exposes the TestUSD name, symbol and 6 decimals", async () => {
      assert.equal(await testUsd.read.name(), "FairCircle Test USD");
      assert.equal(await testUsd.read.symbol(), "tFUSD");
      assert.equal(await testUsd.read.decimals(), 6);
    });

    it("mints public TestUSD", async () => {
      await testUsd.write.mint([recipient, 42n]);
      assert.equal(await testUsd.read.balanceOf([recipient]), 42n);
    });

    it("wraps tFUSD into cFUSD", async () => {
      await testUsd.write.mint([recipient, 80n]);
      await testUsd.write.approve([confidentialUsd.address, 80n], { account: recipient });
      await confidentialUsd.write.wrap([recipient, 80n], { account: recipient });

      assert.equal(await testUsd.read.balanceOf([recipient]), 0n);
      assert.equal(await testUsd.read.balanceOf([confidentialUsd.address]), 2_080n);
      assert.equal(await confidentialBalance(recipient, 5), 80n);
    });

    it("decrypts confidential balances for the holder", async () => {
      assert.equal(await confidentialBalance(memberA, 1), 500n);
    });

    it("transfers confidential tokens between users", async () => {
      await confidentialTransfer(memberA, 1, memberB, 25n);

      assert.equal(await confidentialBalance(memberA, 1), 475n);
      assert.equal(await confidentialBalance(memberB, 2), 525n);
    });

    it("creates an unwrap request", async () => {
      const unwrapHandle = await requestUnwrap(memberA, 1, memberA, 40n);
      assert.equal(
        normalize(await confidentialUsd.read.unwrapRequester([unwrapHandle])),
        normalize(memberA),
      );
    });

    it("rejects invalid unwrap proofs", async () => {
      const unwrapHandle = await requestUnwrap(memberA, 1, memberA, 40n);

      await assert.rejects(
        confidentialUsd.write.finalizeUnwrap([unwrapHandle, "0x1234"]),
        /revert|Malformed|proof|decrypt/i,
      );
    });

    it("finalizes a valid unwrap", async () => {
      const unwrapHandle = await requestUnwrap(memberA, 1, memberA, 40n);
      await finalizeUnwrap(unwrapHandle);

      assert.equal(await testUsd.read.balanceOf([memberA]), 40n);
      assert.equal(await confidentialBalance(memberA, 1), 460n);
    });

    it("sends the exact underlying tFUSD amount once", async () => {
      const unwrapHandle = await requestUnwrap(memberA, 1, memberA, 40n);
      await finalizeUnwrap(unwrapHandle);

      assert.equal(await testUsd.read.balanceOf([memberA]), 40n);
      assert.equal(await testUsd.read.balanceOf([confidentialUsd.address]), 1_960n);
    });

    it("rejects repeated unwrap finalization", async () => {
      const unwrapHandle = await requestUnwrap(memberA, 1, memberA, 40n);
      await finalizeUnwrap(unwrapHandle);

      await assert.rejects(
        finalizeUnwrap(unwrapHandle),
        /InvalidUnwrapRequest|revert/i,
      );
    });
  });

  describe("room creation", () => {
    it("creates a valid open room", async () => {
      const roomId = await createPrivateCircleRoom({
        access: CollectionAccess.Open,
        members: [],
        target: 0n,
      });

      const circle = await getPrivateCircle(roomId);
      assert.equal(circle.access, CollectionAccess.Open);
      assert.equal(circle.memberCount, 0);
      assert.equal(circle.collectionStatus, CollectionStatus.Open);
    });

    it("creates a valid invite-only room", async () => {
      const deadline = await futureDeadline();
      const roomId = await createPrivateCircleRoom({ deadline, target: 120n });
      const circle = await getPrivateCircle(roomId);

      assert.equal(circle.access, CollectionAccess.InviteOnly);
      assert.equal(circle.memberCount, 3);
      assert.equal(circle.publicTarget, 120n);
      assert.equal(circle.deadline, deadline);
      assert.deepEqual((await fairCircle.read.getMembers([roomId])).map(normalize), [
        memberA,
        memberB,
        memberC,
      ].map(normalize));
    });

    it("rejects tokens without IERC7984 support", async () => {
      await assert.rejects(
        createPrivateCircleRoom({ token: testUsd.address }),
        /InvalidToken|revert/i,
      );
    });

    it("rejects EOA token addresses", async () => {
      await assert.rejects(
        createPrivateCircleRoom({ token: outsider }),
        /InvalidToken|revert/i,
      );
    });

    it("rejects zero recipients", async () => {
      await assert.rejects(
        createPrivateCircleRoom({ recipientAddress: ZERO_ADDRESS }),
        /InvalidRecipient|revert/i,
      );
    });

    it("rejects past deadlines", async () => {
      await assert.rejects(
        createPrivateCircleRoom({ deadline: BigInt((await latestTimestamp()) - 1) }),
        /InvalidDeadline|revert/i,
      );
    });

    it("rejects deadlines equal to the current timestamp", async () => {
      await assert.rejects(
        createPrivateCircleRoom({ deadline: BigInt(await latestTimestamp()) }),
        /InvalidDeadline|revert/i,
      );
    });

    it("rejects duplicate invitees", async () => {
      await assert.rejects(
        createPrivateCircleRoom({ members: [memberA, memberB, memberA] }),
        /DuplicateMember|revert/i,
      );
    });

    it("rejects zero invitees", async () => {
      await assert.rejects(
        createPrivateCircleRoom({ members: [memberA, ZERO_ADDRESS, memberB] }),
        /InvalidMember|revert/i,
      );
    });

    it("rejects too few invitees", async () => {
      await assert.rejects(
        createPrivateCircleRoom({ members: [memberA] }),
        /InvalidCollectionMembers|revert/i,
      );
    });

    it("rejects too many invitees", async () => {
      await assert.rejects(
        createPrivateCircleRoom({
          members: wallets.slice(0, 9).map(requireAccount),
        }),
        /InvalidCollectionMembers|revert/i,
      );
    });

    it("rejects open rooms with invitees", async () => {
      await assert.rejects(
        createPrivateCircleRoom({
          access: CollectionAccess.Open,
          members: [memberA, memberB],
        }),
        /InvalidCollectionMembers|revert/i,
      );
    });

    it("rejects targets above the maximum", async () => {
      await assert.rejects(
        createPrivateCircleRoom({ target: MAX_SUPPORTED_AMOUNT + 1n }),
        /InvalidTarget|revert/i,
      );
    });

    it("accepts zero target", async () => {
      const roomId = await createPrivateCircleRoom({ target: 0n });
      assert.equal((await getPrivateCircle(roomId)).publicTarget, 0n);
    });
  });

  describe("callback security", () => {
    it("rejects direct EOA calls to the callback", async () => {
      const roomId = await createPrivateCircleRoom();

      await assert.rejects(
        fairCircle.write.onConfidentialTransferReceived([
          organizer,
          memberA,
          zeroHandle(),
          roomData(roomId),
        ], { account: outsider }),
        /UnauthorizedCallbackToken|revert/i,
      );
    });

    it("rejects callbacks from the wrong ERC-7984 token", async () => {
      const otherConfidentialUsd = await connection.viem.deployContract("FairCircleUSD", [
        testUsd.address,
      ]);
      await testUsd.write.mint([memberA, 10n]);
      await testUsd.write.approve([otherConfidentialUsd.address, 10n], { account: memberA });
      await otherConfidentialUsd.write.wrap([memberA, 10n], { account: memberA });
      const input = await clients[1].encryptInput(10n, "uint256", otherConfidentialUsd.address);
      const roomId = await createPrivateCircleRoom();

      await assert.rejects(
        otherConfidentialUsd.write.confidentialTransferAndCall([
          fairCircle.address,
          input.handle,
          input.handleProof,
          roomData(roomId),
        ], { account: memberA }),
        /UnauthorizedCallbackToken|revert/i,
      );
    });

    it("rejects malformed callback data", async () => {
      const input = await confidentialInput(1, 10n);

      await assert.rejects(
        confidentialUsd.write.confidentialTransferAndCall([
          fairCircle.address,
          input.handle,
          input.handleProof,
          "0x1234",
        ], { account: memberA }),
        /InvalidCallbackData|revert/i,
      );
    });

    it("rejects nonexistent room callbacks", async () => {
      await assert.rejects(
        contribute(999n, 1, 10n),
        /InvalidRoomId|revert/i,
      );
    });

    it("rejects callbacks for the wrong room mode", async () => {
      const roomId = await createQuietBudgetRoom();

      await assert.rejects(
        contribute(roomId, 1, 10n),
        /WrongRoomMode|revert/i,
      );
    });

    it("rejects cancelled rooms", async () => {
      const roomId = await createPrivateCircleRoom();
      await fairCircle.write.cancelRoom([roomId]);

      await assert.rejects(contribute(roomId, 1, 10n), /CollectionNotOpen|revert/i);
    });

    it("rejects closed rooms", async () => {
      const roomId = await createPrivateCircleRoom();
      await fairCircle.write.closePrivateCircle([roomId]);

      await assert.rejects(contribute(roomId, 1, 10n), /CollectionNotOpen|revert/i);
    });

    it("rejects expired rooms", async () => {
      const roomId = await createPrivateCircleRoom({
        deadline: BigInt((await latestTimestamp()) + 60),
      });
      await increaseTime(61);

      await assert.rejects(contribute(roomId, 1, 10n), /SubmissionClosed|revert/i);
    });

    it("rejects invite-only outsiders", async () => {
      const roomId = await createPrivateCircleRoom();

      await assert.rejects(contribute(roomId, 4, 10n), /NotMember|revert/i);
    });

    it("accepts outsiders in open rooms", async () => {
      const roomId = await createPrivateCircleRoom({
        access: CollectionAccess.Open,
        members: [],
      });
      const contributionId = await contribute(roomId, 4, 10n);

      assert.equal(
        normalize((await fairCircle.read.getContribution([contributionId])).contributor),
        normalize(outsider),
      );
    });

    it("uses the actual transferred amount instead of the requested amount", async () => {
      const roomId = await createPrivateCircleRoom();
      const contributionId = await contribute(roomId, 1, 999n);
      await finalizeContribution(contributionId);

      assert.equal(await decryptAggregate(roomId), 0n);
      assert.equal((await fairCircle.read.getContribution([contributionId])).accepted, false);
    });

    it("restores callback ACL for contribution receipts", async () => {
      const roomId = await createPrivateCircleRoom();
      const contributionId = await contribute(roomId, 1, 10n);

      assert.equal(
        await fairCircle.read.isContributionReceiptAllowed([contributionId, fairCircle.address]),
        true,
      );
      assert.equal(
        await fairCircle.read.isContributionReceiptAllowed([contributionId, memberA]),
        true,
      );
    });

    it("does not account direct confidential transfers that bypass the callback", async () => {
      const roomId = await createPrivateCircleRoom();
      const nextContributionId = await fairCircle.read.nextContributionId();
      await confidentialTransfer(memberA, 1, fairCircle.address, 10n);

      assert.equal(await fairCircle.read.nextContributionId(), nextContributionId);
      assert.equal(await decryptAggregate(roomId), 0n);
    });
  });

  describe("contributions", () => {
    it("accepts positive contributions", async () => {
      const roomId = await createPrivateCircleRoom();
      const contributionId = await contribute(roomId, 1, 50n);
      await finalizeContribution(contributionId);

      assert.equal((await fairCircle.read.getContribution([contributionId])).accepted, true);
    });

    it("turns zero transfers into encrypted rejections and refunds", async () => {
      const roomId = await createPrivateCircleRoom();
      const before = await confidentialBalance(memberA, 1);
      const contributionId = await contribute(roomId, 1, 0n);
      await finalizeContribution(contributionId);

      assert.equal(await confidentialBalance(memberA, 1), before);
      assert.equal(await decryptAggregate(roomId), 0n);
      assert.equal((await fairCircle.read.getContribution([contributionId])).accepted, false);
    });

    it("does not alter aggregate for failed amount transfers", async () => {
      const roomId = await createPrivateCircleRoom();
      const contributionId = await contribute(roomId, 1, 999n);
      await finalizeContribution(contributionId);

      assert.equal(await decryptAggregate(roomId), 0n);
      assert.equal((await getPrivateCircle(roomId)).verifiedContributionCount, 0n);
    });

    it("allows one contributor to contribute repeatedly", async () => {
      const roomId = await createPrivateCircleRoom();
      const first = await contribute(roomId, 1, 20n);
      const second = await contribute(roomId, 1, 30n);
      await finalizeContribution(first);
      await finalizeContribution(second);

      assert.equal((await getPrivateCircle(roomId)).verifiedContributionCount, 2n);
    });

    it("tracks cumulative contribution correctly", async () => {
      const roomId = await createPrivateCircleRoom();
      await contribute(roomId, 1, 20n);
      await contribute(roomId, 1, 30n);

      assert.equal(await decryptCumulative(roomId, 1), 50n);
    });

    it("aggregates multiple contributors correctly", async () => {
      const roomId = await createPrivateCircleRoom();
      await contribute(roomId, 1, 20n);
      await contribute(roomId, 2, 30n);
      await contribute(roomId, 3, 40n);

      assert.equal(await decryptAggregate(roomId), 90n);
    });

    it("lets contributors decrypt their receipts", async () => {
      const roomId = await createPrivateCircleRoom();
      const contributionId = await contribute(roomId, 1, 20n);

      assert.equal(await decryptContribution(contributionId, 1), 20n);
    });

    it("lets contributors decrypt their cumulative total", async () => {
      const roomId = await createPrivateCircleRoom();
      await contribute(roomId, 1, 20n);
      await contribute(roomId, 1, 30n);

      assert.equal(await decryptCumulative(roomId, 1), 50n);
    });

    it("prevents organizers from decrypting individual contributions", async () => {
      const roomId = await createPrivateCircleRoom();
      const contributionId = await contribute(roomId, 1, 20n);

      await assert.rejects(
        clients[0].decrypt(await contributionHandle(contributionId, 1)),
        /not authorized|decrypt/i,
      );
    });

    it("prevents outsiders from decrypting individual contributions", async () => {
      const roomId = await createPrivateCircleRoom();
      const contributionId = await contribute(roomId, 1, 20n);

      await assert.rejects(
        clients[4].decrypt(await contributionHandle(contributionId, 1)),
        /not authorized|decrypt/i,
      );
    });

    it("lets organizers decrypt the aggregate", async () => {
      const roomId = await createPrivateCircleRoom();
      await contribute(roomId, 1, 20n);

      assert.equal(await decryptAggregate(roomId), 20n);
    });

    it("prevents contributors from decrypting the aggregate unless they are organizer", async () => {
      const roomId = await createPrivateCircleRoom();
      await contribute(roomId, 1, 20n);

      await assert.rejects(
        clients[1].decrypt(await aggregateHandle(roomId)),
        /not authorized|decrypt/i,
      );
    });

    it("prevents outsiders from decrypting the aggregate", async () => {
      const roomId = await createPrivateCircleRoom();
      await contribute(roomId, 1, 20n);

      await assert.rejects(
        clients[4].decrypt(await aggregateHandle(roomId)),
        /not authorized|decrypt/i,
      );
    });
  });

  describe("contribution finalization", () => {
    it("accepts valid positivity proofs", async () => {
      const roomId = await createPrivateCircleRoom();
      const contributionId = await contribute(roomId, 1, 20n);

      await finalizeContribution(contributionId);
      assert.equal((await fairCircle.read.getContribution([contributionId])).finalized, true);
    });

    it("rejects invalid positivity proofs", async () => {
      const roomId = await createPrivateCircleRoom();
      const contributionId = await contribute(roomId, 1, 20n);

      await assert.rejects(
        fairCircle.write.finalizeContribution([contributionId, "0x1234"]),
        /revert|Malformed|proof|decrypt/i,
      );
    });

    it("rejects proofs for another contribution handle", async () => {
      const roomId = await createPrivateCircleRoom();
      const contributionA = await contribute(roomId, 1, 20n);
      const contributionB = await contribute(roomId, 2, 30n);
      const proofB = await contributionProof(contributionB);

      await assert.rejects(
        fairCircle.write.finalizeContribution([contributionA, proofB.decryptionProof]),
        /revert|Malformed|proof|decrypt/i,
      );
    });

    it("rejects repeated contribution finalization", async () => {
      const roomId = await createPrivateCircleRoom();
      const contributionId = await contribute(roomId, 1, 20n);
      await finalizeContribution(contributionId);

      await assert.rejects(
        finalizeContribution(contributionId),
        /ContributionAlreadyFinalized|revert/i,
      );
    });

    it("does not count rejected contributions", async () => {
      const roomId = await createPrivateCircleRoom();
      const contributionId = await contribute(roomId, 1, 0n);
      await finalizeContribution(contributionId);

      assert.equal((await getPrivateCircle(roomId)).verifiedContributionCount, 0n);
      assert.equal((await getPrivateCircle(roomId)).uniqueContributorCount, 0n);
    });

    it("counts verified contributions correctly", async () => {
      const roomId = await createPrivateCircleRoom();
      await finalizeContribution(await contribute(roomId, 1, 10n));
      await finalizeContribution(await contribute(roomId, 2, 20n));

      assert.equal((await getPrivateCircle(roomId)).verifiedContributionCount, 2n);
    });

    it("counts unique contributors correctly", async () => {
      const roomId = await createPrivateCircleRoom();
      await finalizeContribution(await contribute(roomId, 1, 10n));
      await finalizeContribution(await contribute(roomId, 2, 20n));

      assert.equal((await getPrivateCircle(roomId)).uniqueContributorCount, 2n);
    });

    it("counts repeated contributions as one unique wallet", async () => {
      const roomId = await createPrivateCircleRoom();
      await finalizeContribution(await contribute(roomId, 1, 10n));
      await finalizeContribution(await contribute(roomId, 1, 20n));

      assert.equal((await getPrivateCircle(roomId)).verifiedContributionCount, 2n);
      assert.equal((await getPrivateCircle(roomId)).uniqueContributorCount, 1n);
    });
  });

  describe("target versioning", () => {
    it("finalizes below-target result", async () => {
      const roomId = await createPrivateCircleRoom({ target: 100n });
      await contribute(roomId, 1, 90n);
      await finalizeTarget(roomId);

      assert.deepEqual(await publicTargetStatus(roomId), {
        finalized: true,
        reached: false,
        version: 1n,
      });
    });

    it("finalizes exact-target result", async () => {
      const roomId = await createPrivateCircleRoom({ target: 100n });
      await contribute(roomId, 1, 100n);
      await finalizeTarget(roomId);

      assert.equal((await publicTargetStatus(roomId)).reached, true);
    });

    it("finalizes above-target result", async () => {
      const roomId = await createPrivateCircleRoom({ target: 100n });
      await contribute(roomId, 1, 101n);
      await finalizeTarget(roomId);

      assert.equal((await publicTargetStatus(roomId)).reached, true);
    });

    it("rejects target functions for no-target rooms", async () => {
      const roomId = await createPrivateCircleRoom({ target: 0n });

      await assert.rejects(
        fairCircle.read.getCollectionTargetHandle([roomId]),
        /TargetNotConfigured|revert/i,
      );
      await assert.rejects(
        fairCircle.write.finalizeCollectionTarget([roomId, "0x1234"]),
        /TargetNotConfigured|revert/i,
      );
    });

    it("rejects invalid target proofs", async () => {
      const roomId = await createPrivateCircleRoom({ target: 100n });
      await contribute(roomId, 1, 90n);

      await assert.rejects(
        fairCircle.write.finalizeCollectionTarget([roomId, "0x1234"]),
        /revert|Malformed|proof|decrypt/i,
      );
    });

    it("rejects old target handle proofs for the latest version", async () => {
      const roomId = await createPrivateCircleRoom({ target: 100n });
      await contribute(roomId, 1, 90n);
      const oldProof = await targetProof(roomId);
      await contribute(roomId, 2, 10n);

      await assert.rejects(
        fairCircle.write.finalizeCollectionTarget([roomId, oldProof.decryptionProof]),
        /revert|Malformed|proof|decrypt/i,
      );
    });

    it("rejects repeated finalization of the same target version", async () => {
      const roomId = await createPrivateCircleRoom({ target: 100n });
      await contribute(roomId, 1, 100n);
      await finalizeTarget(roomId);

      await assert.rejects(
        finalizeTarget(roomId),
        /TargetAlreadyFinalized|revert/i,
      );
    });

    it("marks a new target version unfinalized after new contribution", async () => {
      const roomId = await createPrivateCircleRoom({ target: 100n });
      await contribute(roomId, 1, 90n);
      await finalizeTarget(roomId);
      await contribute(roomId, 2, 10n);

      assert.deepEqual(await publicTargetStatus(roomId), {
        finalized: false,
        reached: false,
        version: 2n,
      });
    });

    it("reveals no aggregate value in public target status", async () => {
      const roomId = await createPrivateCircleRoom({ target: 100n });
      await contribute(roomId, 1, 90n);
      await finalizeTarget(roomId);
      const status = await publicTargetStatus(roomId);

      assert.deepEqual(Object.keys(status), ["finalized", "reached", "version"]);
      assert.equal(Object.values(status).includes(90n), false);
    });
  });

  describe("closing, cancellation and withdrawal", () => {
    it("lets organizers cancel before callback", async () => {
      const roomId = await createPrivateCircleRoom();
      await fairCircle.write.cancelRoom([roomId]);

      assert.equal((await getPrivateCircle(roomId)).collectionStatus, CollectionStatus.Cancelled);
    });

    it("rejects outsider cancellation", async () => {
      const roomId = await createPrivateCircleRoom();

      await assert.rejects(
        fairCircle.write.cancelRoom([roomId], { account: outsider }),
        /NotOrganizer|revert/i,
      );
    });

    it("rejects cancellation after callback", async () => {
      const roomId = await createPrivateCircleRoom();
      await contribute(roomId, 1, 10n);

      await assert.rejects(
        fairCircle.write.cancelRoom([roomId]),
        /CollectionHasContributions|revert/i,
      );
    });

    it("lets organizers close", async () => {
      const roomId = await createPrivateCircleRoom();
      await fairCircle.write.closePrivateCircle([roomId]);

      assert.equal((await getPrivateCircle(roomId)).collectionStatus, CollectionStatus.Closed);
    });

    it("rejects outsider close", async () => {
      const roomId = await createPrivateCircleRoom();

      await assert.rejects(
        fairCircle.write.closePrivateCircle([roomId], { account: outsider }),
        /NotOrganizer|revert/i,
      );
    });

    it("rejects contributions after closing", async () => {
      const roomId = await createPrivateCircleRoom();
      await fairCircle.write.closePrivateCircle([roomId]);

      await assert.rejects(contribute(roomId, 1, 10n), /CollectionNotOpen|revert/i);
    });

    it("rejects withdrawal before close and before deadline", async () => {
      const roomId = await createPrivateCircleRoom();
      await finalizeContribution(await contribute(roomId, 1, 10n));

      await assert.rejects(
        fairCircle.write.requestCollectionWithdrawal([roomId]),
        /WithdrawalNotAllowed|revert/i,
      );
    });

    it("permits withdrawal after deadline according to specification", async () => {
      const roomId = await createPrivateCircleRoom({
        deadline: BigInt((await latestTimestamp()) + 60),
      });
      await finalizeContribution(await contribute(roomId, 1, 10n));
      await increaseTime(61);

      await fairCircle.write.requestCollectionWithdrawal([roomId]);
      assert.equal(
        (await getPrivateCircle(roomId)).collectionStatus,
        CollectionStatus.WithdrawalPending,
      );
    });

    it("rejects zero verified-contribution withdrawal", async () => {
      const roomId = await createPrivateCircleRoom();
      await contribute(roomId, 1, 10n);
      await fairCircle.write.closePrivateCircle([roomId]);

      await assert.rejects(
        fairCircle.write.requestCollectionWithdrawal([roomId]),
        /ZeroContributionCollection|revert/i,
      );
    });

    it("lets organizers request withdrawal", async () => {
      const roomId = await withdrawableRoom();
      await fairCircle.write.requestCollectionWithdrawal([roomId]);

      assert.equal(
        (await getPrivateCircle(roomId)).collectionStatus,
        CollectionStatus.WithdrawalPending,
      );
    });

    it("rejects outsider withdrawal requests", async () => {
      const roomId = await withdrawableRoom();

      await assert.rejects(
        fairCircle.write.requestCollectionWithdrawal([roomId], { account: outsider }),
        /NotOrganizer|revert/i,
      );
    });

    it("rejects duplicate withdrawal requests", async () => {
      const roomId = await withdrawableRoom();
      await fairCircle.write.requestCollectionWithdrawal([roomId]);

      await assert.rejects(
        fairCircle.write.requestCollectionWithdrawal([roomId]),
        /WithdrawalAlreadyRequested|revert/i,
      );
    });

    it("transfers exact encrypted aggregate to the recipient", async () => {
      const roomId = await withdrawableRoom(120n);
      await fairCircle.write.requestCollectionWithdrawal([roomId]);
      await finalizeWithdrawal(roomId);

      assert.equal(await decryptWithdrawal(roomId), 120n);
      assert.equal(await confidentialBalance(recipient, 5), 120n);
    });

    it("rejects invalid withdrawal proofs", async () => {
      const roomId = await withdrawableRoom();
      await fairCircle.write.requestCollectionWithdrawal([roomId]);

      await assert.rejects(
        fairCircle.write.finalizeCollectionWithdrawal([roomId, "0x1234"]),
        /revert|Malformed|proof|decrypt/i,
      );
    });

    it("rejects withdrawal proofs from another handle", async () => {
      const roomId = await withdrawableRoom();
      await fairCircle.write.requestCollectionWithdrawal([roomId]);
      const contributionId = await contribute(await createPrivateCircleRoom(), 1, 1n);
      const proof = await contributionProof(contributionId);

      await assert.rejects(
        fairCircle.write.finalizeCollectionWithdrawal([roomId, proof.decryptionProof]),
        /revert|Malformed|proof|decrypt/i,
      );
    });

    it("finalizes valid withdrawal proofs", async () => {
      const roomId = await withdrawableRoom();
      await fairCircle.write.requestCollectionWithdrawal([roomId]);
      await finalizeWithdrawal(roomId);

      assert.equal((await getPrivateCircle(roomId)).collectionStatus, CollectionStatus.Withdrawn);
      assert.equal((await getRoom(roomId)).status, RoomStatus.Finalized);
    });

    it("rejects repeated withdrawal finalization", async () => {
      const roomId = await withdrawableRoom();
      await fairCircle.write.requestCollectionWithdrawal([roomId]);
      await finalizeWithdrawal(roomId);

      await assert.rejects(
        finalizeWithdrawal(roomId),
        /WithdrawalAlreadyFinalized|revert/i,
      );
    });

    it("prevents a second withdrawal", async () => {
      const roomId = await withdrawableRoom();
      await fairCircle.write.requestCollectionWithdrawal([roomId]);
      await finalizeWithdrawal(roomId);

      await assert.rejects(
        fairCircle.write.requestCollectionWithdrawal([roomId]),
        /WithdrawalAlreadyRequested|WithdrawalNotAllowed|revert/i,
      );
    });

    it("does not allow room aggregate reuse after withdrawal", async () => {
      const roomId = await withdrawableRoom(120n);
      await fairCircle.write.requestCollectionWithdrawal([roomId]);
      await finalizeWithdrawal(roomId);

      assert.equal(await decryptAggregate(roomId), 0n);
    });

    it("lets recipients unwrap the exact withdrawn cFUSD amount to tFUSD", async () => {
      const roomId = await withdrawableRoom(120n);
      await fairCircle.write.requestCollectionWithdrawal([roomId]);
      await finalizeWithdrawal(roomId);
      const unwrapHandle = await requestUnwrap(recipient, 5, recipient, 120n);
      await finalizeUnwrap(unwrapHandle);

      assert.equal(await confidentialBalance(recipient, 5), 0n);
      assert.equal(await testUsd.read.balanceOf([recipient]), 120n);
    });
  });

  describe("event privacy", () => {
    it("does not emit plaintext amounts or encrypted handles from FairCircle events", async () => {
      const roomId = await createPrivateCircleRoom({ target: 100n });
      const contributionTx = await contributeTx(roomId, 1, 120n);
      const contributionId = 1n;
      await finalizeContribution(contributionId);
      const targetTx = await txHash(fairCircle.write.finalizeCollectionTarget([
        roomId,
        (await targetProof(roomId)).decryptionProof,
      ]));
      await fairCircle.write.closePrivateCircle([roomId]);
      const requestTx = await txHash(fairCircle.write.requestCollectionWithdrawal([roomId]));
      const withdrawTx = await txHash(fairCircle.write.finalizeCollectionWithdrawal([
        roomId,
        (await withdrawalProof(roomId)).decryptionProof,
      ]));

      const appEvents = [
        ...(await fairCircleEvents(contributionTx)),
        ...(await fairCircleEvents(targetTx)),
        ...(await fairCircleEvents(requestTx)),
        ...(await fairCircleEvents(withdrawTx)),
      ];

      assert.deepEqual([...appEvents.map((event) => event.eventName)].sort(), [
        "CollectionTargetFinalized",
        "CollectionTargetReady",
        "CollectionWithdrawalRequested",
        "CollectionWithdrawn",
        "ContributionReceived",
        "RoomFinalized",
      ].sort());

      for (const event of appEvents) {
        const args = event.args as Record<string, unknown>;
        assert.equal(Object.keys(args).some((key) => /amount|aggregate|handle|receipt/i.test(key)), false);
        assert.equal(Object.values(args).some((value) => value === 120n), false);
      }
    });

    it("distinguishes ERC-7984 token handle events from FairCircle application events", async () => {
      const roomId = await createPrivateCircleRoom({ target: 100n });
      const tx = await contributeTx(roomId, 1, 25n);
      const receipt = await transactionReceipt(tx);
      const fairCircleLogs = receipt.logs.filter(
        (log) => normalize(log.address) === normalize(fairCircle.address),
      );
      const tokenLogs = receipt.logs.filter(
        (log) => normalize(log.address) === normalize(confidentialUsd.address),
      );

      assert.equal(fairCircleLogs.length, 2);
      assert.ok(tokenLogs.length >= 1);
    });
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

  async function createQuietBudgetRoom() {
    const roomId = await fairCircle.read.nextRoomId();
    await fairCircle.write.createQuietBudgetRoom([
      "Quiet",
      [memberA, memberB],
      [100n],
      await futureDeadline(),
      RoomMode.QuietBudget,
    ]);
    return roomId;
  }

  async function withdrawableRoom(total = 10n) {
    const roomId = await createPrivateCircleRoom();
    await finalizeContribution(await contribute(roomId, 1, total));
    await fairCircle.write.closePrivateCircle([roomId]);
    return roomId;
  }

  async function fundConfidentialUsd(account: Address, amount: bigint) {
    await testUsd.write.mint([account, amount]);
    await testUsd.write.approve([confidentialUsd.address, amount], { account });
    await confidentialUsd.write.wrap([account, amount], { account });
  }

  async function confidentialInput(walletIndex: number, amount: bigint) {
    return clients[walletIndex].encryptInput(amount, "uint256", confidentialUsd.address);
  }

  async function confidentialTransfer(
    from: Address,
    walletIndex: number,
    to: Address,
    amount: bigint,
  ) {
    const input = await confidentialInput(walletIndex, amount);
    await confidentialUsd.write.confidentialTransfer(
      [to, input.handle, input.handleProof],
      { account: from },
    );
  }

  async function contribute(roomId: bigint, walletIndex: number, amount: bigint) {
    const contributionId = await fairCircle.read.nextContributionId();
    await contributeTx(roomId, walletIndex, amount);
    return contributionId;
  }

  async function contributeTx(roomId: bigint, walletIndex: number, amount: bigint) {
    const input = await confidentialInput(walletIndex, amount);
    return txHash(confidentialUsd.write.confidentialTransferAndCall(
      [fairCircle.address, input.handle, input.handleProof, roomData(roomId)],
      { account: requireAccount(wallets[walletIndex]) },
    ));
  }

  async function contributionProof(contributionId: bigint) {
    return clients[0].publicDecrypt(
      (await fairCircle.read.getContributionPositivityHandle([contributionId])) as Hex,
    );
  }

  async function finalizeContribution(contributionId: bigint) {
    const proof = await contributionProof(contributionId);
    await fairCircle.write.finalizeContribution([
      contributionId,
      proof.decryptionProof,
    ]);
  }

  async function targetProof(roomId: bigint) {
    return clients[0].publicDecrypt(
      (await fairCircle.read.getCollectionTargetHandle([roomId])) as Hex,
    );
  }

  async function finalizeTarget(roomId: bigint) {
    const proof = await targetProof(roomId);
    await fairCircle.write.finalizeCollectionTarget([
      roomId,
      proof.decryptionProof,
    ]);
  }

  async function withdrawalProof(roomId: bigint) {
    return clients[0].publicDecrypt(
      (await fairCircle.read.getWithdrawalSuccessHandle([roomId])) as Hex,
    );
  }

  async function finalizeWithdrawal(roomId: bigint) {
    const proof = await withdrawalProof(roomId);
    await fairCircle.write.finalizeCollectionWithdrawal([
      roomId,
      proof.decryptionProof,
    ]);
  }

  async function requestUnwrap(
    from: Address,
    walletIndex: number,
    to: Address,
    amount: bigint,
  ) {
    const input = await confidentialInput(walletIndex, amount);
    const hash = await txHash(confidentialUsd.write.unwrap(
      [from, to, input.handle, input.handleProof],
      { account: from },
    ));
    const receipt = await transactionReceipt(hash);
    const [event] = parseEventLogs({
      abi: (confidentialUsd as unknown as { abi: Abi }).abi,
      eventName: "UnwrapRequested",
      logs: receipt.logs,
    });
    assert.ok(event, "unwrap event is emitted");
    return (event.args as { amount: Hex }).amount;
  }

  async function finalizeUnwrap(unwrapHandle: Hex) {
    const proof = await clients[0].publicDecrypt(unwrapHandle);
    await confidentialUsd.write.finalizeUnwrap([unwrapHandle, proof.decryptionProof]);
  }

  async function confidentialBalance(account: Address, walletIndex: number) {
    const handle = await confidentialUsd.read.confidentialBalanceOf([account]);
    return (await clients[walletIndex].decrypt(handle as Hex)).value as bigint;
  }

  async function decryptContribution(contributionId: bigint, walletIndex: number) {
    return (await clients[walletIndex].decrypt(
      await contributionHandle(contributionId, walletIndex),
    )).value as bigint;
  }

  async function decryptCumulative(roomId: bigint, walletIndex: number) {
    return (await clients[walletIndex].decrypt(
      await cumulativeHandle(roomId, walletIndex),
    )).value as bigint;
  }

  async function decryptAggregate(roomId: bigint) {
    return (await clients[0].decrypt(await aggregateHandle(roomId))).value as bigint;
  }

  async function decryptWithdrawal(roomId: bigint) {
    return (await clients[5].decrypt(await withdrawalHandle(roomId))).value as bigint;
  }

  async function contributionHandle(contributionId: bigint, walletIndex: number) {
    return fairCircle.read.getMyContributionHandle([contributionId], {
      account: requireAccount(wallets[walletIndex]),
    }) as Promise<Hex>;
  }

  async function cumulativeHandle(roomId: bigint, walletIndex: number) {
    return fairCircle.read.getMyCumulativeContributionHandle([roomId], {
      account: requireAccount(wallets[walletIndex]),
    }) as Promise<Hex>;
  }

  async function aggregateHandle(roomId: bigint) {
    return fairCircle.read.getCollectionAggregateHandle([roomId]) as Promise<Hex>;
  }

  async function withdrawalHandle(roomId: bigint) {
    return fairCircle.read.getWithdrawalHandle([roomId]) as Promise<Hex>;
  }

  async function publicTargetStatus(roomId: bigint) {
    const [finalized, reached, version] = await fairCircle.read.getPublicTargetStatus([roomId]);
    return { finalized, reached, version };
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
    const room = await getRoom(roomId);
    const circle = await fairCircle.read.getPrivateCircle([roomId]) as {
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
    };
    return { ...circle, memberCount: room.memberCount };
  }

  async function fairCircleEvents(hash: Hex) {
    const receipt = await transactionReceipt(hash);
    return parseEventLogs({
      abi: (fairCircle as unknown as { abi: Abi }).abi,
      logs: receipt.logs.filter((log) => normalize(log.address) === normalize(fairCircle.address)),
    });
  }

  async function transactionReceipt(hash: Hex) {
    const publicClient = await connection.viem.getPublicClient();
    return publicClient.waitForTransactionReceipt({ hash });
  }

  async function txHash(transaction: Promise<unknown>) {
    const hash = await transaction;
    assert.equal(typeof hash, "string");
    assert.match(hash, /^0x[0-9a-fA-F]{64}$/);
    return hash as Hex;
  }

  async function latestTimestamp() {
    const publicClient = await connection.viem.getPublicClient();
    const block = await publicClient.getBlock();
    return Number(block.timestamp);
  }

  async function futureDeadline() {
    return BigInt((await latestTimestamp()) + 3600);
  }

  async function increaseTime(seconds: number) {
    await connection.provider.request({
      method: "evm_increaseTime",
      params: [seconds],
    });
    await connection.provider.request({ method: "evm_mine" });
  }
});

function roomData(roomId: bigint) {
  return encodeAbiParameters([{ type: "uint256" }], [roomId]);
}

function zeroHandle() {
  return `0x${"0".repeat(64)}` as Hex;
}

function normalize(address: Address) {
  return address.toLowerCase();
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
