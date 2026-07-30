"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { createFairCirclePublicClient } from "@/lib/web3/clients";
import {
  fairCircleAbi,
  fairCircleAddress,
  fairCircleDeploymentBlock,
  normalizeRoomView,
  safeWeb3ErrorMessage,
  type QuietBudgetRoomView,
} from "./contract";
import { RoomMode } from "./room-status";

const LOG_CHUNK_SIZE = 50_000n;
const MAX_LOG_RETRIES = 3;

export type QuietBudgetRoomSummary = {
  room: QuietBudgetRoomView;
  members: Address[];
  hasSubmitted: boolean;
  role: "Organizer" | "Member" | "Organizer and member";
};

type RoomsState =
  | { status: "idle" | "loading"; rooms: QuietBudgetRoomSummary[]; error?: string; partialError?: string }
  | { status: "success"; rooms: QuietBudgetRoomSummary[]; snapshotBlock: bigint; partialError?: string }
  | { status: "error"; rooms: QuietBudgetRoomSummary[]; error: string };

export function useQuietBudgetRooms({
  account,
  enabled,
}: {
  account?: Address;
  enabled: boolean;
}) {
  const [state, setState] = useState<RoomsState>({ status: "idle", rooms: [] });
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || account === undefined) {
      requestRef.current += 1;
      setState({ status: "idle", rooms: [] });
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const normalizedAccount = getAddress(account);
    setState((current) => ({ status: "loading", rooms: current.rooms }));

    try {
      const publicClient = createFairCirclePublicClient();
      const snapshotBlock = await publicClient.getBlockNumber();
      if (requestRef.current !== requestId) {
        return;
      }
      const roomIds = await scanQuietBudgetRoomIds(snapshotBlock, () => requestRef.current !== requestId);
      const rooms: QuietBudgetRoomSummary[] = [];
      const readFailures: string[] = [];

      for (const roomId of roomIds) {
        if (requestRef.current !== requestId) {
          return;
        }
        try {
          const [roomValue, membersValue, hasSubmittedValue] = await Promise.all([
            publicClient.readContract({
              address: fairCircleAddress,
              abi: fairCircleAbi,
              functionName: "getRoom",
              args: [roomId],
            }),
            publicClient.readContract({
              address: fairCircleAddress,
              abi: fairCircleAbi,
              functionName: "getMembers",
              args: [roomId],
            }),
            publicClient.readContract({
              address: fairCircleAddress,
              abi: fairCircleAbi,
              functionName: "hasSubmitted",
              args: [roomId, normalizedAccount],
            }),
          ]);
          const room = normalizeRoomView(roomValue);
          if (room.mode !== RoomMode.QuietBudget) {
            continue;
          }
          const members = (membersValue as Address[]).map((member) => getAddress(member));
          const isOrganizer = getAddress(room.organizer) === normalizedAccount;
          const isMember = members.some((member) => getAddress(member) === normalizedAccount);
          if (!isOrganizer && !isMember) {
            continue;
          }
          rooms.push({
            room,
            members,
            hasSubmitted: Boolean(hasSubmittedValue),
            role: isOrganizer && isMember
              ? "Organizer and member"
              : isOrganizer
                ? "Organizer"
                : "Member",
          });
        } catch (error) {
          readFailures.push(safeWeb3ErrorMessage(error));
        }
      }

      if (requestRef.current !== requestId) {
        return;
      }
      setState({
        status: "success",
        rooms: rooms.sort((a, b) => Number(b.room.id - a.room.id)),
        snapshotBlock,
        partialError: readFailures.length > 0
          ? "Some rooms could not be refreshed from the RPC provider."
          : undefined,
      });
    } catch (error) {
      if (requestRef.current !== requestId) {
        return;
      }
      setState({ status: "error", rooms: [], error: safeWeb3ErrorMessage(error) });
    }
  }, [account, enabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      requestRef.current += 1;
    };
  }, [refresh]);

  return { ...state, refresh };
}

async function scanQuietBudgetRoomIds(snapshotBlock: bigint, isCancelled: () => boolean) {
  const publicClient = createFairCirclePublicClient();
  const ids = new Set<bigint>();
  let fromBlock = fairCircleDeploymentBlock;

  while (fromBlock <= snapshotBlock) {
    if (isCancelled()) {
      return [];
    }
    const toBlock = fromBlock + LOG_CHUNK_SIZE - 1n > snapshotBlock
      ? snapshotBlock
      : fromBlock + LOG_CHUNK_SIZE - 1n;
    const events = await withRateLimitRetry(() =>
      publicClient.getContractEvents({
        address: fairCircleAddress,
        abi: fairCircleAbi,
        eventName: "RoomCreated",
        fromBlock,
        toBlock,
      }),
    );
    for (const event of events) {
      const args = event.args as Record<string, unknown>;
      if (Number(args.mode) === RoomMode.QuietBudget) {
        ids.add(BigInt(args.roomId as bigint));
      }
    }
    fromBlock = toBlock + 1n;
  }

  return Array.from(ids);
}

async function withRateLimitRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_LOG_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === MAX_LOG_RETRIES - 1) {
        break;
      }
      await delay(600 * (attempt + 1));
    }
  }
  throw lastError;
}

function isRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate limit|too many requests/i.test(message);
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
