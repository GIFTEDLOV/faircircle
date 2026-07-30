"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { createFairCirclePublicClient } from "@/lib/web3/clients";
import {
  fairCircleAbi,
  fairCircleAddress,
  normalizePublicAffordability,
  normalizeRoomView,
  safeWeb3ErrorMessage,
  type PublicAffordability,
  type QuietBudgetRoomView,
} from "./contract";
import { RoomMode } from "./room-status";

export type QuietBudgetRoomState = {
  room: QuietBudgetRoomView;
  members: Address[];
  options: bigint[];
  publicAffordability: PublicAffordability[];
  isMember: boolean;
  hasSubmitted: boolean;
};

type RoomState =
  | { status: "idle" | "loading"; data?: QuietBudgetRoomState; error?: string }
  | { status: "success"; data: QuietBudgetRoomState }
  | { status: "not-found"; error: string }
  | { status: "error"; data?: QuietBudgetRoomState; error: string };

export function useQuietBudgetRoom({
  roomId,
  account,
  enabled,
}: {
  roomId?: bigint;
  account?: Address;
  enabled: boolean;
}) {
  const [state, setState] = useState<RoomState>({ status: "idle" });
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || roomId === undefined) {
      requestRef.current += 1;
      setState({ status: "idle" });
      return;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({
      status: "loading",
      data: "data" in current ? current.data : undefined,
    }));

    try {
      const publicClient = createFairCirclePublicClient();
      const [roomValue, membersValue, optionsValue] = await Promise.all([
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
          functionName: "getOptions",
          args: [roomId],
        }),
      ]);

      if (requestRef.current !== requestId) {
        return;
      }

      const room = normalizeRoomView(roomValue);
      if (room.mode !== RoomMode.QuietBudget) {
        setState({ status: "not-found", error: "This room is not a QuietBudget room." });
        return;
      }

      const options = (optionsValue as bigint[]).map((value) => BigInt(value));
      const publicAffordability = await Promise.all(
        options.map((_, index) =>
          publicClient.readContract({
            address: fairCircleAddress,
            abi: fairCircleAbi,
            functionName: "getPublicAffordability",
            args: [roomId, BigInt(index)],
          }).then(normalizePublicAffordability),
        ),
      );

      const normalizedAccount = account ? getAddress(account) : undefined;
      const [isMemberValue, hasSubmittedValue] = normalizedAccount
        ? await Promise.all([
            publicClient.readContract({
              address: fairCircleAddress,
              abi: fairCircleAbi,
              functionName: "isMember",
              args: [roomId, normalizedAccount],
            }),
            publicClient.readContract({
              address: fairCircleAddress,
              abi: fairCircleAbi,
              functionName: "hasSubmitted",
              args: [roomId, normalizedAccount],
            }),
          ])
        : [false, false];

      if (requestRef.current !== requestId) {
        return;
      }

      setState({
        status: "success",
        data: {
          room,
          members: (membersValue as Address[]).map((member) => getAddress(member)),
          options,
          publicAffordability,
          isMember: Boolean(isMemberValue),
          hasSubmitted: Boolean(hasSubmittedValue),
        },
      });
    } catch (error) {
      if (requestRef.current !== requestId) {
        return;
      }
      const message = safeWeb3ErrorMessage(error);
      setState({
        status: /InvalidRoomId|invalid room|does not exist/i.test(message) ? "not-found" : "error",
        error: message,
      });
    }
  }, [account, enabled, roomId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      requestRef.current += 1;
    };
  }, [refresh]);

  return { ...state, refresh };
}
