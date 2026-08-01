"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { createFairCirclePublicClient } from "@/lib/web3/clients";
import { withTransientRpcRetry } from "@/lib/web3/retry";
import { fairCircleAbi, fairCircleAddress, normalizeFairSplitRoom, normalizePublicSplitFeasibility, safeWeb3ErrorMessage, type FairSplitRoomView, type PublicSplitFeasibility } from "./contract";

export type FairSplitRoomState = { room: FairSplitRoomView; members: Address[]; isMember: boolean; hasSubmitted: boolean; publicFeasibility: PublicSplitFeasibility; sharesReady: boolean };
type State = { status: "idle" | "loading"; data?: FairSplitRoomState; error?: string } | { status: "success"; data: FairSplitRoomState } | { status: "not-found" | "error"; error: string };

export function useFairSplitRoom({ roomId, account, enabled }: { roomId?: bigint; account?: Address; enabled: boolean }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const requestRef = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled || roomId === undefined) { requestRef.current += 1; setState({ status: "idle" }); return; }
    const requestId = ++requestRef.current;
    setState((current) => ({ status: "loading", data: "data" in current ? current.data : undefined }));
    try {
      const client = createFairCirclePublicClient();
      const [roomValue, membersValue, methodValue, totalCostValue, feasibilityValue, sharesReadyValue] = await Promise.all([
        withTransientRpcRetry(() => client.readContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "getRoom", args: [roomId] })),
        withTransientRpcRetry(() => client.readContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "getMembers", args: [roomId] })),
        withTransientRpcRetry(() => client.readContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "getSplitMethod", args: [roomId] })),
        withTransientRpcRetry(() => client.readContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "getSplitTotalCost", args: [roomId] })),
        withTransientRpcRetry(() => client.readContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "getPublicSplitFeasibility", args: [roomId] })),
        withTransientRpcRetry(() => client.readContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "sharesReady", args: [roomId] })),
      ]);
      if (requestRef.current !== requestId) return;
      const room = normalizeFairSplitRoom(roomValue, methodValue, totalCostValue);
      if (room.mode !== 1) { setState({ status: "not-found", error: "This room is not a FairSplit room." }); return; }
      const normalizedAccount = account ? getAddress(account) : undefined;
      const [isMemberValue, hasSubmittedValue] = normalizedAccount ? await Promise.all([
        withTransientRpcRetry(() => client.readContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "isMember", args: [roomId, normalizedAccount] })),
        withTransientRpcRetry(() => client.readContract({ address: fairCircleAddress, abi: fairCircleAbi, functionName: "hasSubmitted", args: [roomId, normalizedAccount] })),
      ]) : [false, false];
      if (requestRef.current !== requestId) return;
      setState({ status: "success", data: { room, members: (membersValue as Address[]).map((member) => getAddress(member)), isMember: Boolean(isMemberValue), hasSubmitted: Boolean(hasSubmittedValue), publicFeasibility: normalizePublicSplitFeasibility(feasibilityValue), sharesReady: Boolean(sharesReadyValue) } });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      const message = safeWeb3ErrorMessage(error);
      setState({ status: /InvalidRoomId|invalid room|does not exist/i.test(message) ? "not-found" : "error", error: message });
    }
  }, [account, enabled, roomId]);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => { window.clearTimeout(timer); requestRef.current += 1; }; }, [refresh]);
  return { ...state, refresh };
}
