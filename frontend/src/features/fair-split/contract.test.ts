import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex, type Log } from "viem";
import { fairCircleAbi, fairCircleAddress, parseFairSplitRoomCreatedReceipt, parseSplitCapacitySubmittedReceipt, parseSplitFeasibilityFinalizedReceipt, SplitMethod } from "./contract";

const organizer = getAddress("0x00000000000000000000000000000000000000aA");
const member = getAddress("0x00000000000000000000000000000000000000bB");

describe("FairSplit receipt parsing", () => {
  it("extracts and correlates FairSplit room creation", () => {
    const receipt = { logs: [eventLog("FairSplitRoomCreated", { roomId: 12n, organizer, splitMethod: SplitMethod.Equal }, encodeAbiParameters([{ type: "string" }, { type: "uint8" }, { type: "uint64" }, { type: "uint8" }], ["Trip", SplitMethod.Equal, 1_900_000_000n, 2]))] };
    expect(parseFairSplitRoomCreatedReceipt(receipt, { organizer, splitMethod: SplitMethod.Equal })).toEqual({ roomId: 12n });
  });

  it("rejects capacity events for another member", () => {
    const receipt = { logs: [eventLog("SplitCapacitySubmitted", { roomId: 12n, member }, encodeAbiParameters([{ type: "uint8" }], [2]))] };
    expect(() => parseSplitCapacitySubmittedReceipt(receipt, { roomId: 12n, member: organizer })).toThrow(/does not match/);
  });

  it("correlates the published feasibility boolean", () => {
    const receipt = { logs: [eventLog("SplitFeasibilityFinalized", { roomId: 12n }, encodeAbiParameters([{ type: "bool" }], [true]))] };
    expect(parseSplitFeasibilityFinalizedReceipt(receipt, { roomId: 12n, feasible: true })).toEqual({ feasible: true });
  });
});

function eventLog(eventName: string, args: Record<string, unknown>, data: Hex): Log {
  const topics = encodeEventTopics({ abi: fairCircleAbi, eventName, args: args as never });
  return { address: fairCircleAddress, topics, data, blockHash: null, blockNumber: null, logIndex: null, transactionHash: null, transactionIndex: null, removed: false };
}
