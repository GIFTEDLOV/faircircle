import type { Address } from "viem";

export const Stage = {
  Budget: 0,
  Split: 1,
  Collection: 2,
  Complete: 3,
  Cancelled: 4,
} as const;

export const CollectionStatus = {
  Open: 0,
  Closed: 1,
  WithdrawalPending: 2,
  Withdrawn: 3,
  Cancelled: 4,
} as const;

export type PlanView = {
  id: bigint;
  title: string;
  organizer: Address;
  stage: number | bigint;
  budgetRoomId: bigint;
  selectedOptionIndex: bigint;
  selectedCost: bigint;
  splitMethod: number | bigint;
  splitRoomId: bigint;
  collectionRoomId: bigint;
  intendedRecipient: Address;
  createdAt: bigint;
  updatedAt: bigint;
};

export type PrivateCircleView = {
  id: bigint;
  title: string;
  organizer: Address;
  confidentialToken: Address;
  recipient: Address;
  publicTarget: bigint;
  deadline: bigint;
  access: number | bigint;
  collectionStatus: number | bigint;
  verifiedContributionCount: bigint;
  uniqueContributorCount: bigint;
  targetVersion: bigint;
};

export function asPlanView(value: unknown): PlanView {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("getPlan returned an unexpected positional tuple.");
  }
  if (!("stage" in value)) {
    throw new Error("getPlan result is missing named stage field.");
  }
  return value as PlanView;
}

export function asPrivateCircleView(value: unknown): PrivateCircleView {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("getPrivateCircle returned an unexpected positional tuple.");
  }
  if (!("collectionStatus" in value)) {
    throw new Error("getPrivateCircle result is missing named collectionStatus field.");
  }
  return value as PrivateCircleView;
}

export function readPlanStage(plan: PlanView) {
  return Number(plan.stage);
}

export function assertPlanComplete(plan: PlanView) {
  const stage = readPlanStage(plan);
  if (stage !== Stage.Complete) {
    throw new Error(`Expected plan stage Complete (${Stage.Complete}), got ${stage}.`);
  }
}
