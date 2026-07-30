import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Address,
  type Hex,
  type Log,
} from "viem";
import {
  createStateInvalidator,
  fairCircleAbi,
  fairCircleAddress,
  parseAffordabilityFinalizedReceipt,
  parseCapacitySubmittedReceipt,
  parseRoomCreatedReceipt,
  safeWeb3ErrorMessage,
} from "./contract";
import { RoomMode } from "./room-status";

const member = getAddress("0x00000000000000000000000000000000000000aA");
const organizer = getAddress("0x00000000000000000000000000000000000000bB");
const otherContract = getAddress("0x00000000000000000000000000000000000000Cc");

describe("QuietBudget receipt parsing", () => {
  it("extracts the actual RoomCreated room ID", () => {
    const receipt = receiptWith(
      roomCreatedLog({ roomId: 42n, organizer, contract: fairCircleAddress }),
    );
    expect(parseRoomCreatedReceipt(receipt, { organizer })).toEqual({
      roomId: 42n,
      organizer,
    });
  });

  it("rejects RoomCreated logs from the wrong contract address", () => {
    const receipt = receiptWith(
      roomCreatedLog({ roomId: 42n, organizer, contract: otherContract }),
    );
    expect(() => parseRoomCreatedReceipt(receipt)).toThrow(/missing RoomCreated/);
  });

  it("rejects ambiguous RoomCreated logs", () => {
    const receipt = receiptWith(
      roomCreatedLog({ roomId: 42n, organizer, contract: fairCircleAddress }),
      roomCreatedLog({ roomId: 43n, organizer, contract: fairCircleAddress }),
    );
    expect(() => parseRoomCreatedReceipt(receipt)).toThrow(/multiple RoomCreated/);
  });

  it("correlates CapacitySubmitted by room and connected member", () => {
    const receipt = receiptWith(capacitySubmittedLog({ roomId: 9n, member }));
    expect(parseCapacitySubmittedReceipt(receipt, { roomId: 9n, member })).toEqual({
      submissionCount: 1,
    });
    expect(() =>
      parseCapacitySubmittedReceipt(receipt, { roomId: 10n, member }),
    ).toThrow(/does not match/);
  });

  it("correlates AffordabilityFinalized by room, option, and boolean result", () => {
    const receipt = receiptWith(affordabilityFinalizedLog({
      roomId: 9n,
      optionIndex: 2,
      affordable: true,
    }));
    expect(
      parseAffordabilityFinalizedReceipt(receipt, {
        roomId: 9n,
        optionIndex: 2,
        affordable: true,
      }),
    ).toEqual({ affordable: true });
    expect(() =>
      parseAffordabilityFinalizedReceipt(receipt, {
        roomId: 9n,
        optionIndex: 2,
        affordable: false,
      }),
    ).toThrow(/does not match/);
  });
});

describe("QuietBudget state safety helpers", () => {
  it("invalidates wallet-change scoped state", () => {
    const invalidator = createStateInvalidator();
    const first = invalidator.invalidate();
    expect(invalidator.isCurrent(first)).toBe(true);
    invalidator.invalidate();
    expect(invalidator.isCurrent(first)).toBe(false);
  });

  it("prevents stale async responses from being accepted", async () => {
    const invalidator = createStateInvalidator();
    const first = invalidator.invalidate();
    const second = invalidator.invalidate();
    const staleAllowed = await Promise.resolve(invalidator.isCurrent(first));
    const freshAllowed = await Promise.resolve(invalidator.isCurrent(second));
    expect(staleAllowed).toBe(false);
    expect(freshAllowed).toBe(true);
  });

  it("sanitizes RPC URLs from errors", () => {
    const message = safeWeb3ErrorMessage(
      new Error("failed at https://secret.example/rpc/key and wss://node.example/ws"),
    );
    expect(message).not.toContain("secret.example");
    expect(message).not.toContain("node.example");
    expect(message).toContain("[redacted-url]");
  });
});

function roomCreatedLog({
  roomId,
  contract,
}: {
  roomId: bigint;
  organizer: Address;
  contract: Address;
}): Log {
  const topics = encodeEventTopics({
    abi: fairCircleAbi,
    eventName: "RoomCreated",
    args: {
      roomId,
      organizer,
    },
  });
  const data = encodeAbiParameters(
    [
      { type: "string" },
      { type: "uint8" },
      { type: "uint64" },
      { type: "uint8" },
      { type: "uint8" },
    ],
    ["Test room", RoomMode.QuietBudget, 1_800_000_000n, 2, 2],
  );
  return log(contract, topics, data);
}

function capacitySubmittedLog({ roomId, member }: { roomId: bigint; member: Address }): Log {
  const topics = encodeEventTopics({
    abi: fairCircleAbi,
    eventName: "CapacitySubmitted",
    args: { roomId, member },
  });
  const data = encodeAbiParameters([{ type: "uint8" }], [1]);
  return log(fairCircleAddress, topics, data);
}

function affordabilityFinalizedLog({
  roomId,
  optionIndex,
  affordable,
}: {
  roomId: bigint;
  optionIndex: number;
  affordable: boolean;
}): Log {
  const topics = encodeEventTopics({
    abi: fairCircleAbi,
    eventName: "AffordabilityFinalized",
    args: { roomId, optionIndex },
  });
  const data = encodeAbiParameters([{ type: "bool" }], [affordable]);
  return log(fairCircleAddress, topics, data);
}

function receiptWith(...logs: Log[]) {
  return { logs };
}

function log(address: Address, topics: readonly Hex[], data: Hex): Log {
  return {
    address,
    topics,
    data,
    blockHash: null,
    blockNumber: null,
    logIndex: null,
    transactionHash: null,
    transactionIndex: null,
    removed: false,
  };
}
