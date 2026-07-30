import { describe, expect, it, vi } from "vitest";
import { getAddress, type Address } from "viem";
import {
  ROOM_HISTORY_CHUNK_SIZE,
  ROOM_HISTORY_MAX_RETRIES,
  RoomHistoryError,
  discoverQuietBudgetRoomsForAccount,
  normalizeRoomHistoryAccount,
  roomHistoryDeploymentBlock,
  sanitizeRoomHistoryDiagnostic,
  scanQuietBudgetRoomIds,
  withRoomHistoryRetry,
  type RoomHistoryClient,
} from "./room-history";
import { RoomMode } from "./room-status";
import {
  normalizeRoomHistoryRoom,
  shouldAcceptRoomHistoryResponse,
} from "./use-quiet-budget-rooms";

vi.mock("server-only", () => ({}));

const organizer = getAddress("0x00000000000000000000000000000000000000aA");
const member = getAddress("0x00000000000000000000000000000000000000bB");
const outsider = getAddress("0x00000000000000000000000000000000000000cC");

describe("room history request validation", () => {
  it("rejects an invalid account query", () => {
    expect(() => normalizeRoomHistoryAccount("not-an-address")).toThrow(RoomHistoryError);
  });

  it("does not accept stale or aborted client responses", () => {
    expect(shouldAcceptRoomHistoryResponse({
      requestId: 2,
      currentRequestId: 2,
      signal: { aborted: false },
    })).toBe(true);
    expect(shouldAcceptRoomHistoryResponse({
      requestId: 1,
      currentRequestId: 2,
      signal: { aborted: false },
    })).toBe(false);
    expect(shouldAcceptRoomHistoryResponse({
      requestId: 2,
      currentRequestId: 2,
      signal: { aborted: true },
    })).toBe(false);
  });

  it("normalizes API rooms without exposing server configuration", () => {
    const room = normalizeRoomHistoryRoom({
      room: serializedRoom(3n, organizer),
      members: [member],
      hasSubmitted: true,
      role: "Organizer",
    });
    expect(room.room.id).toBe(3n);
    expect(room.room.submissionDeadline).toBe(1_800_000_000n);
    expect(Object.keys(room)).not.toContain("serverRpcUrl");
  });
});

describe("room history scanning", () => {
  it("uses one fixed latest-block snapshot and scans chunks sequentially", async () => {
    const client = mockClient({
      snapshotBlock: roomHistoryDeploymentBlock + ROOM_HISTORY_CHUNK_SIZE,
      eventsByChunk: [
        [{ args: { roomId: 1n, mode: RoomMode.QuietBudget } }],
        [{ args: { roomId: 2n, mode: RoomMode.QuietBudget } }],
      ],
    });
    const result = await discoverQuietBudgetRoomsForAccount({ client, account: organizer, delay: noDelay });
    expect(client.getBlockNumber).toHaveBeenCalledTimes(1);
    expect(client.getContractEvents).toHaveBeenCalledTimes(2);
    expect(result.snapshotBlock).toBe((roomHistoryDeploymentBlock + ROOM_HISTORY_CHUNK_SIZE).toString());
    expect(client.chunkOrder).toEqual([0, 1]);
  });

  it("filters only QuietBudget events", async () => {
    const client = mockClient({
      snapshotBlock: roomHistoryDeploymentBlock,
      eventsByChunk: [[
        { args: { roomId: 1n, mode: RoomMode.QuietBudget } },
        { args: { roomId: 2n, mode: RoomMode.FairSplit } },
      ]],
    });
    await expect(scanQuietBudgetRoomIds({ client, snapshotBlock: roomHistoryDeploymentBlock, delay: noDelay }))
      .resolves.toEqual([1n]);
  });

  it("includes organizer-only and member-only rooms, excludes unrelated rooms, and maps hasSubmitted", async () => {
    const client = mockClient({
      snapshotBlock: roomHistoryDeploymentBlock,
      eventsByChunk: [[
        { args: { roomId: 1n, mode: RoomMode.QuietBudget } },
        { args: { roomId: 2n, mode: RoomMode.QuietBudget } },
        { args: { roomId: 3n, mode: RoomMode.QuietBudget } },
      ]],
      rooms: {
        1: { organizer, members: [outsider], submitted: true },
        2: { organizer: outsider, members: [organizer], submitted: false },
        3: { organizer: outsider, members: [member], submitted: false },
      },
    });
    const result = await discoverQuietBudgetRoomsForAccount({ client, account: organizer, delay: noDelay });
    expect(result.rooms.map((room) => room.room.id)).toEqual(["2", "1"]);
    expect(result.rooms.map((room) => room.role)).toEqual(["Member", "Organizer"]);
    expect(result.rooms.find((room) => room.room.id === "1")?.hasSubmitted).toBe(true);
  });

  it("retries rate limits and fails with a typed message after exhaustion", async () => {
    const retrying = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 429 rate limit"))
      .mockResolvedValue("ok");
    await expect(withRoomHistoryRetry(retrying, noDelay)).resolves.toBe("ok");
    expect(retrying).toHaveBeenCalledTimes(2);

    const exhausted = vi.fn().mockRejectedValue(new Error("too many requests"));
    await expect(withRoomHistoryRetry(exhausted, noDelay)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "The room-history provider is temporarily rate limited.",
    });
    expect(exhausted).toHaveBeenCalledTimes(ROOM_HISTORY_MAX_RETRIES);
  });
});

describe("room history sanitization", () => {
  it("redacts upstream RPC URLs and request bodies", () => {
    const message = sanitizeRoomHistoryDiagnostic(
      new Error(
        'POST https://provider.example/rpc/token {"body":"{\"method\":\"eth_getLogs\"}","headers":{"authorization":"secret"}}',
      ),
    );
    expect(message).not.toContain("provider.example");
    expect(message).not.toContain("eth_getLogs");
    expect(message).not.toContain("authorization");
    expect(message).toContain("[redacted-url]");
    expect(message).toContain("[redacted-body]");
  });
});

function mockClient({
  snapshotBlock,
  eventsByChunk,
  rooms,
}: {
  snapshotBlock: bigint;
  eventsByChunk: Array<Array<{ args: Record<string, unknown> }>>;
  rooms?: Record<number, { organizer: Address; members: Address[]; submitted: boolean }>;
}) {
  const chunkOrder: number[] = [];
  const client = {
    chunkOrder,
    getBlockNumber: vi.fn(async () => snapshotBlock),
    getContractEvents: vi.fn(async () => {
      const index = chunkOrder.length;
      chunkOrder.push(index);
      return eventsByChunk[index] ?? [];
    }),
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      const roomId = Number(args[0]);
      const room = rooms?.[roomId] ?? { organizer, members: [member], submitted: false };
      if (functionName === "getRoom") {
        return {
          id: BigInt(roomId),
          title: `Room ${roomId}`,
          organizer: room.organizer,
          mode: RoomMode.QuietBudget,
          status: 0,
          submissionDeadline: 1_800_000_000n,
          memberCount: room.members.length,
          submissionCount: room.submitted ? 1 : 0,
          optionCount: 1,
          finalizedOptionCount: 0,
        };
      }
      if (functionName === "getMembers") {
        return room.members;
      }
      if (functionName === "hasSubmitted") {
        return room.submitted;
      }
      throw new Error("unexpected read");
    }),
  };
  return client as RoomHistoryClient & typeof client;
}

function serializedRoom(id: bigint, organizerAddress: Address) {
  return {
    id: id.toString(),
    title: "Room",
    organizer: organizerAddress,
    mode: RoomMode.QuietBudget,
    status: 0,
    submissionDeadline: "1800000000",
    memberCount: 1,
    submissionCount: 1,
    optionCount: 1,
    finalizedOptionCount: 0,
  };
}

function noDelay() {
  return Promise.resolve();
}
