import {
  getAddress,
  parseEventLogs,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import {
  fairCircleAbi,
  fairCircleAddress,
  fairCircleDeploymentBlock,
  safeWeb3ErrorMessage,
  MAX_SUPPORTED_AMOUNT_FALLBACK,
} from "@/features/quiet-budget/contract";

export { fairCircleAbi, fairCircleAddress, fairCircleDeploymentBlock, safeWeb3ErrorMessage, MAX_SUPPORTED_AMOUNT_FALLBACK };

export const SplitMethod = {
  Equal: 0,
  CapacityWeighted: 1,
} as const;

export type PublicSplitFeasibility = {
  finalized: boolean;
  feasible: boolean;
};

export type FairSplitRoomView = {
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
  splitMethod: number;
  totalCost: bigint;
};

export function normalizeFairSplitRoom(value: unknown, splitMethod: unknown, totalCost: unknown): FairSplitRoomView {
  const room = value as {
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
  };
  return {
    id: BigInt(room.id),
    title: room.title,
    organizer: getAddress(room.organizer),
    mode: Number(room.mode),
    status: Number(room.status),
    submissionDeadline: BigInt(room.submissionDeadline),
    memberCount: Number(room.memberCount),
    submissionCount: Number(room.submissionCount),
    optionCount: Number(room.optionCount),
    finalizedOptionCount: Number(room.finalizedOptionCount),
    splitMethod: Number(splitMethod),
    totalCost: BigInt(totalCost as bigint),
  };
}

export function normalizePublicSplitFeasibility(value: unknown): PublicSplitFeasibility {
  const tuple = value as readonly [boolean, boolean];
  return { finalized: Boolean(tuple[0]), feasible: Boolean(tuple[1]) };
}

export function parseFairSplitRoomCreatedReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  expected: { organizer: Address; splitMethod: number },
) {
  const event = requireEvent(receipt.logs, "FairSplitRoomCreated");
  const args = event.args as Record<string, unknown>;
  if (getAddress(args.organizer as Address) !== getAddress(expected.organizer)) {
    throw new Error("The room creation receipt does not match the connected wallet.");
  }
  if (Number(args.splitMethod) !== expected.splitMethod) {
    throw new Error("The confirmed room uses a different split method.");
  }
  return { roomId: BigInt(args.roomId as bigint) };
}

export function parseSplitCapacitySubmittedReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  expected: { roomId: bigint; member: Address },
) {
  const event = requireEvent(receipt.logs, "SplitCapacitySubmitted");
  const args = event.args as Record<string, unknown>;
  if (
    BigInt(args.roomId as bigint) !== expected.roomId ||
    getAddress(args.member as Address) !== getAddress(expected.member)
  ) {
    throw new Error("The capacity submission receipt does not match this room and wallet.");
  }
  return { submissionCount: Number(args.submissionCount) };
}

export function parseSplitFeasibilityFinalizedReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  expected: { roomId: bigint; feasible: boolean },
) {
  const event = requireEvent(receipt.logs, "SplitFeasibilityFinalized");
  const args = event.args as Record<string, unknown>;
  if (BigInt(args.roomId as bigint) !== expected.roomId || Boolean(args.feasible) !== expected.feasible) {
    throw new Error("The feasibility receipt does not match this room and result.");
  }
  return { feasible: Boolean(args.feasible) };
}

function requireEvent(logs: Log[], eventName: string) {
  const events = parseEventLogs({
    abi: fairCircleAbi,
    eventName,
    logs: logs.filter((log) => getAddress(log.address) === fairCircleAddress),
    strict: true,
  });
  if (events.length !== 1) {
    throw new Error(
      events.length === 0
        ? `The confirmed receipt is missing ${eventName}.`
        : `The confirmed receipt contains multiple ${eventName} events.`,
    );
  }
  return events[0];
}

export function sepoliaTxUrl(hash: Hex) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}
