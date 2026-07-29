import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";
import {
  handleGatewayUrl,
  NOX_COMPUTE_ADDRESS,
  nox,
} from "@iexec-nox/nox-hardhat-plugin";
import {
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

const SplitMethod = {
  Equal: 0,
  CapacityWeighted: 1,
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

const Stage = {
  Budget: 0,
  Split: 1,
  Collection: 2,
  Complete: 3,
  Cancelled: 4,
} as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

describe("FairCirclePlanTogether", () => {
  let connection: NoxConnection;
  let fairCircle: DeployedContract;
  let planTogether: DeployedContract;
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
    for (const wallet of wallets.slice(0, 9)) {
      assert.ok(wallet.account, "wallet account is available");
    }

    organizer = requireAccount(wallets[0]);
    memberA = requireAccount(wallets[1]);
    memberB = requireAccount(wallets[2]);
    memberC = requireAccount(wallets[3]);
    outsider = requireAccount(wallets[4]);
    recipient = requireAccount(wallets[5]);

    clients = await Promise.all(
      wallets.slice(0, 9).map((wallet) =>
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
    planTogether = await connection.viem.deployContract("FairCirclePlanTogether", [
      fairCircle.address,
      confidentialUsd.address,
    ]);
  });

  describe("constructor", () => {
    it("deploys with valid dependencies", async () => {
      assert.equal(normalize(await planTogether.read.fairCircleCore()), normalize(fairCircle.address));
      assert.equal(
        normalize(await planTogether.read.approvedConfidentialToken()),
        normalize(confidentialUsd.address),
      );
    });

    it("rejects zero core", async () => {
      await assert.rejects(
        connection.viem.deployContract("FairCirclePlanTogether", [
          ZERO_ADDRESS,
          confidentialUsd.address,
        ]),
        /InvalidCore|revert/i,
      );
    });

    it("rejects EOA core", async () => {
      await assert.rejects(
        connection.viem.deployContract("FairCirclePlanTogether", [
          outsider,
          confidentialUsd.address,
        ]),
        /InvalidCore|revert/i,
      );
    });

    it("rejects zero token", async () => {
      await assert.rejects(
        connection.viem.deployContract("FairCirclePlanTogether", [
          fairCircle.address,
          ZERO_ADDRESS,
        ]),
        /InvalidToken|revert/i,
      );
    });

    it("rejects EOA token", async () => {
      await assert.rejects(
        connection.viem.deployContract("FairCirclePlanTogether", [
          fairCircle.address,
          outsider,
        ]),
        /InvalidToken|revert/i,
      );
    });

    it("rejects non-IERC7984 token", async () => {
      await assert.rejects(
        connection.viem.deployContract("FairCirclePlanTogether", [
          fairCircle.address,
          testUsd.address,
        ]),
        /InvalidToken|revert/i,
      );
    });
  });

  describe("plan creation", () => {
    it("creates a valid plan from a PlanTogether budget room", async () => {
      const budgetRoomId = await createBudgetRoom();
      const planId = await createPlan(budgetRoomId);

      const plan = await getPlan(planId);
      assert.equal(plan.stage, Stage.Budget);
      assert.equal(plan.budgetRoomId, budgetRoomId);
      assert.equal(plan.organizer.toLowerCase(), organizer.toLowerCase());
    });

    it("rejects standalone QuietBudget rooms", async () => {
      const budgetRoomId = await createBudgetRoom({ mode: RoomMode.QuietBudget });

      await assert.rejects(createPlan(budgetRoomId), /InvalidBudgetRoom|revert/i);
    });

    it("rejects FairSplit rooms as budget rooms", async () => {
      const splitRoomId = await createFairSplitRoom({ totalCost: 150n });

      await assert.rejects(createPlan(splitRoomId), /InvalidBudgetRoom|revert/i);
    });

    it("rejects PrivateCircle rooms as budget rooms", async () => {
      const collectionRoomId = await createPrivateCircleRoom();

      await assert.rejects(createPlan(collectionRoomId), /InvalidBudgetRoom|revert/i);
    });

    it("rejects non-organizers", async () => {
      const budgetRoomId = await createBudgetRoom();

      await assert.rejects(
        createPlan(budgetRoomId, { account: outsider }),
        /NotOrganizer|revert/i,
      );
    });

    it("rejects zero recipients", async () => {
      const budgetRoomId = await createBudgetRoom();

      await assert.rejects(
        createPlan(budgetRoomId, { intendedRecipient: ZERO_ADDRESS }),
        /InvalidRecipient|revert/i,
      );
    });

    it("copies the title", async () => {
      const budgetRoomId = await createBudgetRoom({ title: "Weekend plan" });
      const planId = await createPlan(budgetRoomId);

      assert.equal((await getPlan(planId)).title, "Weekend plan");
    });

    it("copies ordered members", async () => {
      const budgetRoomId = await createBudgetRoom({ members: [memberB, memberA, memberC] });
      const planId = await createPlan(budgetRoomId);

      assert.deepEqual((await planTogether.read.getPlanMembers([planId])).map(normalize), [
        memberB,
        memberA,
        memberC,
      ].map(normalize));
    });

    it("stores selected split method intent", async () => {
      const budgetRoomId = await createBudgetRoom();
      const planId = await createPlan(budgetRoomId, {
        splitMethod: SplitMethod.CapacityWeighted,
      });

      assert.equal((await getPlan(planId)).splitMethod, SplitMethod.CapacityWeighted);
    });

    it("rejects reused budget rooms", async () => {
      const budgetRoomId = await createBudgetRoom();
      await createPlan(budgetRoomId);

      await assert.rejects(createPlan(budgetRoomId), /RoomAlreadyLinked|revert/i);
    });
  });

  describe("option selection", () => {
    it("rejects selection before budget finalization", async () => {
      const planId = await createPlan(await createBudgetRoom());

      await assert.rejects(selectOption(planId, 1), /WrongStage|revert/i);
    });

    it("rejects non-organizer selection", async () => {
      const { planId } = await finalizedBudgetPlan();

      await assert.rejects(
        selectOption(planId, 1, { account: outsider }),
        /NotOrganizer|revert/i,
      );
    });

    it("rejects invalid options", async () => {
      const { planId } = await finalizedBudgetPlan();

      await assert.rejects(selectOption(planId, 9), /InvalidOptionIndex|revert/i);
    });

    it("rejects unfinalized affordability", async () => {
      const budgetRoomId = await createBudgetRoom({ members: [memberA, memberB], options: [100n] });
      await submitBudgetCapacity(budgetRoomId, 1, 60n);
      await submitBudgetCapacity(budgetRoomId, 2, 60n);
      const planId = await createPlan(budgetRoomId);

      await assert.rejects(selectOption(planId, 0), /WrongStage|revert|OptionNotFinalized/i);
    });

    it("rejects unaffordable options", async () => {
      const { planId } = await finalizedBudgetPlan();

      await assert.rejects(selectOption(planId, 2), /OptionNotAffordable|revert/i);
    });

    it("accepts finalized affordable options", async () => {
      const { planId } = await finalizedBudgetPlan();
      await selectOption(planId, 1);

      assert.equal((await getPlan(planId)).selectedOptionIndex, 1n);
    });

    it("stores the selected public cost", async () => {
      const { planId } = await finalizedBudgetPlan();
      await selectOption(planId, 1);

      assert.equal((await getPlan(planId)).selectedCost, 150n);
    });

    it("rejects repeated selection", async () => {
      const { planId } = await finalizedBudgetPlan();
      await selectOption(planId, 1);

      await assert.rejects(selectOption(planId, 0), /WrongStage|revert/i);
    });

    it("advances to Split", async () => {
      const { planId } = await finalizedBudgetPlan();
      await selectOption(planId, 1);

      assert.equal((await getPlan(planId)).stage, Stage.Split);
    });
  });

  describe("split linking", () => {
    it("rejects linking before option selection", async () => {
      const planId = await createPlan(await createBudgetRoom());
      const splitRoomId = await createFairSplitRoom({ totalCost: 150n });

      await assert.rejects(linkSplit(planId, splitRoomId), /WrongStage|revert/i);
    });

    it("rejects wrong child mode", async () => {
      const planId = await selectedPlan();
      const budgetRoomId = await createBudgetRoom();

      await assert.rejects(linkSplit(planId, budgetRoomId), /RoomAlreadyLinked|InvalidChildRoom|revert/i);
    });

    it("rejects wrong split organizer", async () => {
      const planId = await selectedPlan();
      const splitRoomId = await createFairSplitRoom({
        totalCost: 150n,
        account: outsider,
        members: [memberA, memberB, memberC],
      });

      await assert.rejects(linkSplit(planId, splitRoomId), /OrganizerMismatch|revert/i);
    });

    it("rejects missing members", async () => {
      const planId = await selectedPlan();
      const splitRoomId = await createFairSplitRoom({ totalCost: 150n, members: [memberA, memberB] });

      await assert.rejects(linkSplit(planId, splitRoomId), /MemberCountMismatch|revert/i);
    });

    it("rejects extra members", async () => {
      const planId = await selectedPlan();
      const splitRoomId = await createFairSplitRoom({
        totalCost: 150n,
        members: [memberA, memberB, memberC, outsider],
      });

      await assert.rejects(linkSplit(planId, splitRoomId), /MemberCountMismatch|revert/i);
    });

    it("rejects different members", async () => {
      const planId = await selectedPlan();
      const splitRoomId = await createFairSplitRoom({
        totalCost: 150n,
        members: [memberA, memberB, outsider],
      });

      await assert.rejects(linkSplit(planId, splitRoomId), /MemberMismatch|revert/i);
    });

    it("rejects different member ordering", async () => {
      const planId = await selectedPlan();
      const splitRoomId = await createFairSplitRoom({
        totalCost: 150n,
        members: [memberB, memberA, memberC],
      });

      await assert.rejects(linkSplit(planId, splitRoomId), /MemberMismatch|revert/i);
    });

    it("rejects wrong total cost", async () => {
      const planId = await selectedPlan();
      const splitRoomId = await createFairSplitRoom({ totalCost: 100n });

      await assert.rejects(linkSplit(planId, splitRoomId), /CostMismatch|revert/i);
    });

    it("rejects wrong split method", async () => {
      const planId = await selectedPlan({ splitMethod: SplitMethod.CapacityWeighted });
      const splitRoomId = await createFairSplitRoom({
        totalCost: 150n,
        splitMethod: SplitMethod.Equal,
      });

      await assert.rejects(linkSplit(planId, splitRoomId), /SplitMethodMismatch|revert/i);
    });

    it("rejects reused split rooms", async () => {
      const planId = await selectedPlan();
      const splitRoomId = await createFairSplitRoom({ totalCost: 150n });
      await linkSplit(planId, splitRoomId);

      const secondPlanId = await selectedPlan();
      await assert.rejects(linkSplit(secondPlanId, splitRoomId), /RoomAlreadyLinked|revert/i);
    });

    it("links valid equal split rooms", async () => {
      const planId = await selectedPlan();
      const splitRoomId = await createFairSplitRoom({ totalCost: 150n });
      await linkSplit(planId, splitRoomId);

      assert.equal((await getPlan(planId)).splitRoomId, splitRoomId);
    });

    it("links valid weighted split rooms", async () => {
      const planId = await selectedPlan({ splitMethod: SplitMethod.CapacityWeighted });
      const splitRoomId = await createFairSplitRoom({
        totalCost: 150n,
        splitMethod: SplitMethod.CapacityWeighted,
      });
      await linkSplit(planId, splitRoomId);

      assert.equal((await getPlan(planId)).splitRoomId, splitRoomId);
    });

    it("rejects confirmation before shares are ready", async () => {
      const planId = await selectedPlan({ splitMethod: SplitMethod.CapacityWeighted });
      const splitRoomId = await createFairSplitRoom({
        totalCost: 150n,
        splitMethod: SplitMethod.CapacityWeighted,
      });
      await linkSplit(planId, splitRoomId);

      await assert.rejects(confirmSplit(planId), /SplitNotReady|revert/i);
    });

    it("rejects weighted infeasible splits", async () => {
      const planId = await selectedPlan({ splitMethod: SplitMethod.CapacityWeighted });
      const splitRoomId = await createFairSplitRoom({
        totalCost: 150n,
        splitMethod: SplitMethod.CapacityWeighted,
      });
      await submitAndFinalizeWeightedSplit(splitRoomId, [10n, 20n, 30n]);
      await linkSplit(planId, splitRoomId);

      await assert.rejects(confirmSplit(planId), /SplitNotReady|SplitNotFeasible|revert/i);
    });

    it("allows permissionless confirmation when ready", async () => {
      const planId = await linkedReadySplitPlan();
      await confirmSplit(planId, { account: outsider });

      assert.equal((await getPlan(planId)).stage, Stage.Collection);
    });

    it("rejects repeated confirmation", async () => {
      const planId = await linkedReadySplitPlan();
      await confirmSplit(planId);

      await assert.rejects(confirmSplit(planId), /WrongStage|revert/i);
    });

    it("advances to Collection", async () => {
      const planId = await linkedReadySplitPlan();
      await confirmSplit(planId);

      assert.equal((await getPlan(planId)).stage, Stage.Collection);
    });
  });

  describe("collection linking", () => {
    it("rejects linking before split confirmation", async () => {
      const planId = await linkedReadySplitPlan();
      const collectionRoomId = await createPrivateCircleRoom({ target: 150n });

      await assert.rejects(linkCollection(planId, collectionRoomId), /WrongStage|revert/i);
    });

    it("rejects wrong collection mode", async () => {
      const planId = await collectionStagePlan();
      const splitRoomId = await createFairSplitRoom({ totalCost: 150n });

      await assert.rejects(linkCollection(planId, splitRoomId), /InvalidChildRoom|revert/i);
    });

    it("rejects wrong collection organizer", async () => {
      const planId = await collectionStagePlan();
      const collectionRoomId = await createPrivateCircleRoom({
        target: 150n,
        account: outsider,
        members: [memberA, memberB, memberC],
      });

      await assert.rejects(linkCollection(planId, collectionRoomId), /OrganizerMismatch|revert/i);
    });

    it("rejects wrong approved token", async () => {
      const planId = await collectionStagePlan();
      const otherToken = await connection.viem.deployContract("FairCircleUSD", [testUsd.address]);
      const collectionRoomId = await createPrivateCircleRoom({ target: 150n, token: otherToken.address });

      await assert.rejects(linkCollection(planId, collectionRoomId), /TokenMismatch|revert/i);
    });

    it("rejects wrong recipient", async () => {
      const planId = await collectionStagePlan();
      const collectionRoomId = await createPrivateCircleRoom({ target: 150n, recipientAddress: outsider });

      await assert.rejects(linkCollection(planId, collectionRoomId), /RecipientMismatch|revert/i);
    });

    it("rejects wrong public target", async () => {
      const planId = await collectionStagePlan();
      const collectionRoomId = await createPrivateCircleRoom({ target: 100n });

      await assert.rejects(linkCollection(planId, collectionRoomId), /TargetMismatch|revert/i);
    });

    it("rejects open collections", async () => {
      const planId = await collectionStagePlan();
      const collectionRoomId = await createPrivateCircleRoom({
        target: 150n,
        access: CollectionAccess.Open,
        members: [],
      });

      await assert.rejects(linkCollection(planId, collectionRoomId), /MemberCountMismatch|CollectionAccessMismatch|revert/i);
    });

    it("rejects missing collection members", async () => {
      const planId = await collectionStagePlan();
      const collectionRoomId = await createPrivateCircleRoom({ target: 150n, members: [memberA, memberB] });

      await assert.rejects(linkCollection(planId, collectionRoomId), /MemberCountMismatch|revert/i);
    });

    it("rejects different collection members", async () => {
      const planId = await collectionStagePlan();
      const collectionRoomId = await createPrivateCircleRoom({
        target: 150n,
        members: [memberA, memberB, outsider],
      });

      await assert.rejects(linkCollection(planId, collectionRoomId), /MemberMismatch|revert/i);
    });

    it("rejects different collection ordering", async () => {
      const planId = await collectionStagePlan();
      const collectionRoomId = await createPrivateCircleRoom({
        target: 150n,
        members: [memberB, memberA, memberC],
      });

      await assert.rejects(linkCollection(planId, collectionRoomId), /MemberMismatch|revert/i);
    });

    it("rejects reused collection rooms", async () => {
      const planId = await collectionStagePlan();
      const collectionRoomId = await createPrivateCircleRoom({ target: 150n });
      await linkCollection(planId, collectionRoomId);
      const secondPlanId = await collectionStagePlan();

      await assert.rejects(linkCollection(secondPlanId, collectionRoomId), /RoomAlreadyLinked|revert/i);
    });

    it("links valid collection rooms", async () => {
      const planId = await collectionStagePlan();
      const collectionRoomId = await createPrivateCircleRoom({ target: 150n });
      await linkCollection(planId, collectionRoomId);

      assert.equal((await getPlan(planId)).collectionRoomId, collectionRoomId);
    });
  });

  describe("completion and cancellation", () => {
    it("rejects completion without linked collection", async () => {
      const planId = await collectionStagePlan();

      await assert.rejects(completePlan(planId), /CollectionRoomNotLinked|revert/i);
    });

    it("rejects completion before withdrawal", async () => {
      const planId = await collectionStagePlan();
      await linkCollection(planId, await createPrivateCircleRoom({ target: 150n }));

      await assert.rejects(completePlan(planId), /CollectionNotWithdrawn|revert/i);
    });

    it("allows permissionless completion after withdrawal", async () => {
      const { planId } = await withdrawnCollectionPlan();
      await completePlan(planId, { account: outsider });

      assert.equal((await getPlan(planId)).stage, Stage.Complete);
    });

    it("rejects repeated completion", async () => {
      const { planId } = await withdrawnCollectionPlan();
      await completePlan(planId);

      await assert.rejects(completePlan(planId), /WrongStage|revert/i);
    });

    it("allows organizer cancellation before collection linking", async () => {
      const planId = await collectionStagePlan();
      await cancelPlan(planId);

      assert.equal((await getPlan(planId)).stage, Stage.Cancelled);
    });

    it("rejects outsider cancellation", async () => {
      const planId = await collectionStagePlan();

      await assert.rejects(cancelPlan(planId, { account: outsider }), /NotOrganizer|revert/i);
    });

    it("rejects cancellation after collection linking", async () => {
      const planId = await collectionStagePlan();
      await linkCollection(planId, await createPrivateCircleRoom({ target: 150n }));

      await assert.rejects(cancelPlan(planId), /CancellationClosed|revert/i);
    });

    it("rejects completion after cancellation", async () => {
      const planId = await collectionStagePlan();
      await cancelPlan(planId);

      await assert.rejects(completePlan(planId), /WrongStage|revert/i);
    });

    it("does not mutate child rooms when cancelling the coordinator plan", async () => {
      const planId = await linkedReadySplitPlan();
      const splitRoomId = (await getPlan(planId)).splitRoomId;
      await cancelPlan(planId);

      assert.equal((await getRoom(splitRoomId)).status, RoomStatus.Finalized);
      assert.equal(await fairCircle.read.sharesReady([splitRoomId]), true);
    });
  });

  describe("security and events", () => {
    it("does not expose encrypted handle getters in the coordinator ABI", async () => {
      const abi = (planTogether as unknown as { abi: Abi }).abi;
      const handleFunctions = abi.filter(
        (entry) =>
          entry.type === "function" &&
          /handle|capacity|share|contribution|aggregate|withdrawal/i.test(entry.name),
      );

      assert.deepEqual(handleFunctions, []);
    });

    it("never receives confidential token transfers in a full flow", async () => {
      const { receipts } = await completedPlanWithReceipts();
      const tokenTransfersToCoordinator = receipts.flatMap((receipt) =>
        receipt.logs.filter(
          (log) =>
            normalize(log.address) === normalize(confidentialUsd.address) &&
            log.topics.some((topic) => normalize(topic.slice(-40) as Address) === normalize(planTogether.address)),
        ),
      );

      assert.equal(tokenTransfersToCoordinator.length, 0);
    });

    it("prevents a child room from being linked in two different stage positions", async () => {
      const planId = await collectionStagePlan();
      const splitRoomId = (await getPlan(planId)).splitRoomId;

      await assert.rejects(linkCollection(planId, splitRoomId), /RoomAlreadyLinked|InvalidChildRoom|revert/i);
    });

    it("prevents child rooms from being linked to two plans", async () => {
      const planId = await collectionStagePlan();
      const collectionRoomId = await createPrivateCircleRoom({ target: 150n });
      await linkCollection(planId, collectionRoomId);
      const secondPlanId = await collectionStagePlan();

      await assert.rejects(linkCollection(secondPlanId, collectionRoomId), /RoomAlreadyLinked|revert/i);
    });

    it("emits only public coordination metadata", async () => {
      const { receipts } = await completedPlanWithReceipts();
      const events = receipts.flatMap((receipt) =>
        parseEventLogs({
          abi: (planTogether as unknown as { abi: Abi }).abi,
          logs: receipt.logs.filter(
            (log) => normalize(log.address) === normalize(planTogether.address),
          ),
        }),
      );

      assert.ok(events.length >= 6);
      for (const event of events) {
        const args = event.args as Record<string, unknown>;
        assert.equal(Object.keys(args).some((key) => /handle|encrypted|proof|capacity|share|contribution/i.test(key)), false);
      }
    });

    it("prevents stage skipping", async () => {
      const planId = await createPlan(await createBudgetRoom());
      await assert.rejects(confirmSplit(planId), /WrongStage|revert/i);
      await assert.rejects(linkCollection(planId, await createPrivateCircleRoom({ target: 150n })), /WrongStage|revert/i);
      await assert.rejects(completePlan(planId), /WrongStage|revert/i);
    });
  });

  async function createBudgetRoom({
    title = "Plan trip",
    members = [memberA, memberB, memberC],
    options = [100n, 150n, 200n],
    mode = RoomMode.PlanTogether,
    account = organizer,
  }: {
    title?: string;
    members?: Address[];
    options?: bigint[];
    mode?: number;
    account?: Address;
  } = {}) {
    const roomId = await fairCircle.read.nextRoomId();
    await fairCircle.write.createQuietBudgetRoom([
      title,
      members,
      options,
      await futureDeadline(),
      mode,
    ], { account });
    return roomId;
  }

  async function createPlan(
    budgetRoomId: bigint,
    {
      splitMethod = SplitMethod.Equal,
      intendedRecipient = recipient,
      account = organizer,
    }: {
      splitMethod?: number;
      intendedRecipient?: Address;
      account?: Address;
    } = {},
  ) {
    const planId = await planTogether.read.nextPlanId();
    await planTogether.write.createPlanFromBudgetRoom([
      budgetRoomId,
      splitMethod,
      intendedRecipient,
    ], { account });
    return planId;
  }

  async function finalizedBudgetPlan({
    splitMethod = SplitMethod.Equal,
  }: { splitMethod?: number } = {}) {
    const budgetRoomId = await createBudgetRoom();
    await finalizeBudget(budgetRoomId);
    const planId = await createPlan(budgetRoomId, { splitMethod });
    return { budgetRoomId, planId };
  }

  async function selectedPlan({ splitMethod = SplitMethod.Equal }: { splitMethod?: number } = {}) {
    const { planId } = await finalizedBudgetPlan({ splitMethod });
    await selectOption(planId, 1);
    return planId;
  }

  async function linkedReadySplitPlan({ splitMethod = SplitMethod.Equal }: { splitMethod?: number } = {}) {
    const planId = await selectedPlan({ splitMethod });
    const splitRoomId = await createFairSplitRoom({ totalCost: 150n, splitMethod });
    if (splitMethod === SplitMethod.CapacityWeighted) {
      await submitAndFinalizeWeightedSplit(splitRoomId, [50n, 50n, 50n]);
    }
    await linkSplit(planId, splitRoomId);
    return planId;
  }

  async function collectionStagePlan({ splitMethod = SplitMethod.Equal }: { splitMethod?: number } = {}) {
    const planId = await linkedReadySplitPlan({ splitMethod });
    await confirmSplit(planId);
    return planId;
  }

  async function withdrawnCollectionPlan() {
    const planId = await collectionStagePlan();
    const collectionRoomId = await createPrivateCircleRoom({ target: 150n });
    await linkCollection(planId, collectionRoomId);
    await withdrawCollection(collectionRoomId, 150n);
    return { planId, collectionRoomId };
  }

  async function completedPlanWithReceipts() {
    const receipts: Awaited<ReturnType<typeof transactionReceipt>>[] = [];
    const budgetRoomId = await createBudgetRoom();
    await finalizeBudget(budgetRoomId);
    receipts.push(await transactionReceipt(await txHash(planTogether.write.createPlanFromBudgetRoom([
      budgetRoomId,
      SplitMethod.Equal,
      recipient,
    ]))));
    const planId = (await planTogether.read.nextPlanId()) - 1n;
    receipts.push(await transactionReceipt(await txHash(planTogether.write.selectAffordableOption([planId, 1n]))));
    const splitRoomId = await createFairSplitRoom({ totalCost: 150n });
    receipts.push(await transactionReceipt(await txHash(planTogether.write.linkFairSplitRoom([planId, splitRoomId]))));
    receipts.push(await transactionReceipt(await txHash(planTogether.write.confirmSplitReady([planId]))));
    const collectionRoomId = await createPrivateCircleRoom({ target: 150n });
    receipts.push(await transactionReceipt(await txHash(planTogether.write.linkPrivateCircleRoom([planId, collectionRoomId]))));
    await withdrawCollection(collectionRoomId, 150n);
    receipts.push(await transactionReceipt(await txHash(planTogether.write.completePlan([planId]))));
    return { planId, receipts };
  }

  async function finalizeBudget(roomId: bigint, capacities = [60n, 60n, 40n]) {
    for (let i = 0; i < capacities.length; i += 1) {
      await submitBudgetCapacity(roomId, i + 1, capacities[i]);
    }
    const options = await fairCircle.read.getOptions([roomId]);
    for (let i = 0; i < options.length; i += 1) {
      const proof = await clients[0].publicDecrypt(
        (await fairCircle.read.getAffordabilityHandle([roomId, BigInt(i)])) as Hex,
      );
      await fairCircle.write.finalizeAffordability([
        roomId,
        BigInt(i),
        proof.decryptionProof,
      ]);
    }
  }

  async function submitBudgetCapacity(roomId: bigint, walletIndex: number, value: bigint) {
    const input = await clients[walletIndex].encryptInput(value, "uint256", fairCircle.address);
    await fairCircle.write.submitPrivateCapacity([
      roomId,
      input.handle,
      input.handleProof,
    ], { account: requireAccount(wallets[walletIndex]) });
  }

  async function selectOption(planId: bigint, optionIndex: number, { account = organizer }: { account?: Address } = {}) {
    await planTogether.write.selectAffordableOption([planId, BigInt(optionIndex)], { account });
  }

  async function createFairSplitRoom({
    totalCost,
    members = [memberA, memberB, memberC],
    splitMethod = SplitMethod.Equal,
    account = organizer,
  }: {
    totalCost: bigint;
    members?: Address[];
    splitMethod?: number;
    account?: Address;
  }) {
    const roomId = await fairCircle.read.nextRoomId();
    await fairCircle.write.createFairSplitRoom([
      "Plan split",
      members,
      totalCost,
      await futureDeadline(),
      splitMethod,
    ], { account });
    return roomId;
  }

  async function submitAndFinalizeWeightedSplit(roomId: bigint, capacities: bigint[]) {
    for (let i = 0; i < capacities.length; i += 1) {
      const walletIndex = i + 1;
      const input = await clients[walletIndex].encryptInput(
        capacities[i],
        "uint256",
        fairCircle.address,
      );
      await fairCircle.write.submitSplitCapacity([
        roomId,
        input.handle,
        input.handleProof,
      ], { account: requireAccount(wallets[walletIndex]) });
    }
    const proof = await clients[0].publicDecrypt(
      (await fairCircle.read.getSplitFeasibilityHandle([roomId])) as Hex,
    );
    await fairCircle.write.finalizeSplitFeasibility([roomId, proof.decryptionProof]);
  }

  async function linkSplit(planId: bigint, splitRoomId: bigint) {
    await planTogether.write.linkFairSplitRoom([planId, splitRoomId]);
  }

  async function confirmSplit(planId: bigint, { account = organizer }: { account?: Address } = {}) {
    await planTogether.write.confirmSplitReady([planId], { account });
  }

  async function createPrivateCircleRoom({
    token = confidentialUsd.address,
    recipientAddress = recipient,
    target = 150n,
    access = CollectionAccess.InviteOnly,
    members = [memberA, memberB, memberC],
    account = organizer,
  }: {
    token?: Address;
    recipientAddress?: Address;
    target?: bigint;
    access?: number;
    members?: Address[];
    account?: Address;
  } = {}) {
    const roomId = await fairCircle.read.nextRoomId();
    await fairCircle.write.createPrivateCircleRoom([
      "Plan collection",
      token,
      recipientAddress,
      target,
      await futureDeadline(),
      access,
      members,
    ], { account });
    return roomId;
  }

  async function linkCollection(planId: bigint, collectionRoomId: bigint) {
    await planTogether.write.linkPrivateCircleRoom([planId, collectionRoomId]);
  }

  async function withdrawCollection(collectionRoomId: bigint, amount: bigint) {
    await fundConfidentialUsd(memberA, amount);
    const contributionId = await fairCircle.read.nextContributionId();
    const input = await clients[1].encryptInput(amount, "uint256", confidentialUsd.address);
    await confidentialUsd.write.confidentialTransferAndCall([
      fairCircle.address,
      input.handle,
      input.handleProof,
      roomData(collectionRoomId),
    ], { account: memberA });
    const contributionProof = await clients[0].publicDecrypt(
      (await fairCircle.read.getContributionPositivityHandle([contributionId])) as Hex,
    );
    await fairCircle.write.finalizeContribution([
      contributionId,
      contributionProof.decryptionProof,
    ]);
    const targetProof = await clients[0].publicDecrypt(
      (await fairCircle.read.getCollectionTargetHandle([collectionRoomId])) as Hex,
    );
    await fairCircle.write.finalizeCollectionTarget([
      collectionRoomId,
      targetProof.decryptionProof,
    ]);
    await fairCircle.write.closePrivateCircle([collectionRoomId]);
    await fairCircle.write.requestCollectionWithdrawal([collectionRoomId]);
    const withdrawalProof = await clients[0].publicDecrypt(
      (await fairCircle.read.getWithdrawalSuccessHandle([collectionRoomId])) as Hex,
    );
    await fairCircle.write.finalizeCollectionWithdrawal([
      collectionRoomId,
      withdrawalProof.decryptionProof,
    ]);
  }

  async function fundConfidentialUsd(account: Address, amount: bigint) {
    await testUsd.write.mint([account, amount]);
    await testUsd.write.approve([confidentialUsd.address, amount], { account });
    await confidentialUsd.write.wrap([account, amount], { account });
  }

  async function cancelPlan(planId: bigint, { account = organizer }: { account?: Address } = {}) {
    await planTogether.write.cancelPlan([planId], { account });
  }

  async function completePlan(planId: bigint, { account = organizer }: { account?: Address } = {}) {
    await planTogether.write.completePlan([planId], { account });
  }

  async function getPlan(planId: bigint) {
    return planTogether.read.getPlan([planId]) as Promise<{
      id: bigint;
      title: string;
      organizer: Address;
      stage: number;
      budgetRoomId: bigint;
      selectedOptionIndex: bigint;
      selectedCost: bigint;
      splitMethod: number;
      splitRoomId: bigint;
      collectionRoomId: bigint;
      intendedRecipient: Address;
      createdAt: bigint;
      updatedAt: bigint;
    }>;
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

  async function futureDeadline() {
    return BigInt((await latestTimestamp()) + 3600);
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
});

function roomData(roomId: bigint) {
  return `0x${roomId.toString(16).padStart(64, "0")}` as Hex;
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
