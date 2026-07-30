import { NextResponse, type NextRequest } from "next/server";
import { MissingServerRpcError, createServerSepoliaPublicClient } from "@/lib/web3/server-public-client";
import {
  RoomHistoryError,
  discoverQuietBudgetRoomsForAccount,
  normalizeRoomHistoryAccount,
  roomHistoryClientMessage,
  sanitizeRoomHistoryDiagnostic,
} from "@/features/quiet-budget/room-history";

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const recentRequests = new Map<string, number[]>();

export async function GET(request: NextRequest) {
  const rateKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  if (!allowRequest(rateKey, Date.now())) {
    return jsonError(
      new RoomHistoryError(
        "RATE_LIMITED",
        "The room-history provider is temporarily rate limited.",
        429,
      ),
    );
  }

  try {
    const account = normalizeRoomHistoryAccount(request.nextUrl.searchParams.get("account"));
    const client = createServerSepoliaPublicClient();
    const result = await discoverQuietBudgetRoomsForAccount({ client, account });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof MissingServerRpcError) {
      return jsonError(new RoomHistoryError("MISSING_RPC", error.message, 503));
    }
    if (error instanceof RoomHistoryError) {
      logSanitizedDiagnostic(error);
      return jsonError(error);
    }
    logSanitizedDiagnostic(error);
    return jsonError(new RoomHistoryError("FAILED", roomHistoryClientMessage(error), 502));
  }
}

function jsonError(error: RoomHistoryError) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
    },
    { status: error.status },
  );
}

function allowRequest(key: string, nowMs: number) {
  const current = recentRequests.get(key)?.filter((time) => nowMs - time < RATE_LIMIT_WINDOW_MS) ?? [];
  if (current.length >= RATE_LIMIT_MAX_REQUESTS) {
    recentRequests.set(key, current);
    return false;
  }
  current.push(nowMs);
  recentRequests.set(key, current);
  return true;
}

function logSanitizedDiagnostic(error: unknown) {
  console.warn("[quiet-budget-room-history]", sanitizeRoomHistoryDiagnostic(error));
}
