"use client";

import {
  getAddress,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import { fairCircleDeployment } from "@/generated/contracts";
import { RoomMode } from "./room-status";

export const fairCircleContract = fairCircleDeployment.contracts.FairCircle;
export const fairCircleAddress = getAddress(fairCircleContract.address);
export const fairCircleAbi = fairCircleContract.abi as Abi;
export const fairCircleDeploymentBlock = BigInt(fairCircleContract.blockNumber);
export const MAX_SUPPORTED_AMOUNT_FALLBACK = 10n ** 36n;

export type QuietBudgetRoomView = {
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

export type PublicAffordability = {
  finalized: boolean;
  affordable: boolean;
};

export function normalizeRoomView(value: unknown): QuietBudgetRoomView {
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
  };
}

export function normalizePublicAffordability(value: unknown): PublicAffordability {
  const tuple = value as readonly [boolean, boolean];
  return { finalized: Boolean(tuple[0]), affordable: Boolean(tuple[1]) };
}

export function parseRoomCreatedReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  expected?: { organizer?: Address },
) {
  const [event] = requireSingleFairCircleEvent(receipt.logs, "RoomCreated");
  const args = event.args as Record<string, unknown>;
  if (Number(args.mode) !== RoomMode.QuietBudget) {
    throw new Error("The confirmed transaction did not create a QuietBudget room.");
  }
  if (
    expected?.organizer !== undefined &&
    getAddress(args.organizer as Address) !== getAddress(expected.organizer)
  ) {
    throw new Error("The room creation receipt does not match the connected wallet.");
  }
  return {
    roomId: BigInt(args.roomId as bigint),
    organizer: getAddress(args.organizer as Address),
  };
}

export function parseCapacitySubmittedReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  expected: { roomId: bigint; member: Address },
) {
  const [event] = requireSingleFairCircleEvent(receipt.logs, "CapacitySubmitted");
  const args = event.args as Record<string, unknown>;
  if (
    BigInt(args.roomId as bigint) !== expected.roomId ||
    getAddress(args.member as Address) !== getAddress(expected.member)
  ) {
    throw new Error("The capacity submission receipt does not match this room and wallet.");
  }
  return { submissionCount: Number(args.submissionCount) };
}

export function parseAffordabilityFinalizedReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  expected: { roomId: bigint; optionIndex: number; affordable: boolean },
) {
  const [event] = requireSingleFairCircleEvent(receipt.logs, "AffordabilityFinalized");
  const args = event.args as Record<string, unknown>;
  if (
    BigInt(args.roomId as bigint) !== expected.roomId ||
    Number(args.optionIndex) !== expected.optionIndex ||
    Boolean(args.affordable) !== expected.affordable
  ) {
    throw new Error("The published result receipt does not match the expected option.");
  }
  return { affordable: Boolean(args.affordable) };
}

export function parseRoomCancelledReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  expected: { roomId: bigint },
) {
  const [event] = requireSingleFairCircleEvent(receipt.logs, "RoomCancelled");
  const args = event.args as Record<string, unknown>;
  if (BigInt(args.roomId as bigint) !== expected.roomId) {
    throw new Error("The cancellation receipt does not match this room.");
  }
  return { roomId: expected.roomId };
}

export function safeWeb3ErrorMessage(error: unknown) {
  const raw = error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "The wallet or Sepolia request failed.";
  return raw
    .replace(/https?:\/\/[^\s"')]+/gi, "[redacted-url]")
    .replace(/wss?:\/\/[^\s"')]+/gi, "[redacted-url]")
    .replace(/(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?=\/|\b)/g, "[redacted-host]")
    .slice(0, 420);
}

export function createStateInvalidator() {
  let version = 0;
  return {
    invalidate() {
      version += 1;
      return version;
    },
    current() {
      return version;
    },
    isCurrent(candidate: number) {
      return candidate === version;
    },
  };
}

function requireSingleFairCircleEvent(logs: Log[], eventName: string) {
  const fairCircleLogs = logs.filter(
    (log) => getAddress(log.address) === fairCircleAddress,
  );
  const events = parseEventLogs({
    abi: fairCircleAbi,
    eventName,
    logs: fairCircleLogs,
    strict: true,
  });
  if (events.length !== 1) {
    throw new Error(
      events.length === 0
        ? `The confirmed receipt is missing ${eventName}.`
        : `The confirmed receipt contains multiple ${eventName} events.`,
    );
  }
  return events;
}

export function sepoliaTxUrl(hash: Hex) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}
