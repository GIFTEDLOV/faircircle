"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import {
  type QuietBudgetRoomView,
} from "./contract";
import type { SerializedQuietBudgetRoom } from "./room-history";

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
  return useRoomHistoryRooms({ account, enabled, mode: "quiet-budget" });
}

export function useRoomHistoryRooms({
  account,
  enabled,
  mode,
}: {
  account?: Address;
  enabled: boolean;
  mode: "quiet-budget" | "fair-split";
}) {
  const [state, setState] = useState<RoomsState>({ status: "idle", rooms: [] });
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!enabled || account === undefined) {
      requestRef.current += 1;
      abortRef.current?.abort();
      setState({ status: "idle", rooms: [] });
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const normalizedAccount = getAddress(account);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((current) => ({ status: "loading", rooms: current.rooms }));

    try {
      const response = await fetch(`/api/quiet-budget/rooms?account=${normalizedAccount}&mode=${mode}`, {
        method: "GET",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      const payload = await response.json() as RoomHistoryApiResponse;
      if (!shouldAcceptRoomHistoryResponse({
        requestId,
        currentRequestId: requestRef.current,
        signal: controller.signal,
      })) {
        return;
      }
      if (!payload.ok) {
        throw new Error(payload.error.message);
      }
      setState({
        status: "success",
        rooms: payload.rooms.map(normalizeRoomHistoryRoom),
        snapshotBlock: BigInt(payload.snapshotBlock),
        partialError: payload.partialError,
      });
    } catch (error) {
      if (!shouldAcceptRoomHistoryResponse({
        requestId,
        currentRequestId: requestRef.current,
        signal: controller.signal,
      })) {
        return;
      }
      setState({
        status: "error",
        rooms: [],
        error: error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Room history could not be loaded. Try again.",
      });
    }
  }, [account, enabled, mode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      requestRef.current += 1;
      abortRef.current?.abort();
    };
  }, [refresh]);

  return { ...state, refresh };
}

export type RoomHistoryApiResponse =
  | ({
      ok: true;
      account: Address;
      snapshotBlock: string;
      rooms: SerializedQuietBudgetRoom[];
      partialError?: string;
    })
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

export function normalizeRoomHistoryRoom(room: SerializedQuietBudgetRoom): QuietBudgetRoomSummary {
  return {
    room: {
      ...room.room,
      id: BigInt(room.room.id),
      organizer: getAddress(room.room.organizer),
      submissionDeadline: BigInt(room.room.submissionDeadline),
    },
    members: room.members.map((member) => getAddress(member)),
    hasSubmitted: room.hasSubmitted,
    role: room.role,
  };
}

export function shouldAcceptRoomHistoryResponse({
  requestId,
  currentRequestId,
  signal,
}: {
  requestId: number;
  currentRequestId: number;
  signal: Pick<AbortSignal, "aborted">;
}) {
  return requestId === currentRequestId && !signal.aborted;
}
