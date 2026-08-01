import { getAddress, isAddress, type Abi, type Address } from "viem";
import { fairCircleDeployment } from "@/generated/contracts";
import { RoomMode } from "./room-status";

export const ROOM_HISTORY_CHUNK_SIZE = 10_000n;
export const ROOM_HISTORY_MAX_CHUNKS = 80;
export const ROOM_HISTORY_MAX_ROOMS = 100;
export const ROOM_HISTORY_MAX_RETRIES = 3;

const fairCircleContract = fairCircleDeployment.contracts.FairCircle;
export const roomHistoryFairCircleAddress = getAddress(fairCircleContract.address);
export const roomHistoryFairCircleAbi = fairCircleContract.abi as Abi;
export const roomHistoryDeploymentBlock = BigInt(fairCircleContract.blockNumber);

export type RoomHistoryErrorCode =
  | "INVALID_ACCOUNT"
  | "MISSING_RPC"
  | "RATE_LIMITED"
  | "HISTORY_UNAVAILABLE"
  | "TOO_MUCH_HISTORY"
  | "FAILED";

export class RoomHistoryError extends Error {
  constructor(
    public readonly code: RoomHistoryErrorCode,
    message: string,
    public readonly status = 500,
  ) {
    super(message);
    this.name = "RoomHistoryError";
  }
}

export type RoomHistoryClient = {
  getBlockNumber: () => Promise<bigint>;
  getContractEvents: (args: {
    address: Address;
    abi: Abi;
    eventName: "RoomCreated" | "PrivateCircleCreated" | "ContributionReceived";
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<Array<{ args: Record<string, unknown> }>>;
  readContract: (args: {
    address: Address;
    abi: Abi;
    functionName: "getRoom" | "getMembers" | "hasSubmitted" | "getPrivateCircle";
    args: readonly unknown[];
  }) => Promise<unknown>;
};

export type RoomHistoryMode = typeof RoomMode.QuietBudget | typeof RoomMode.FairSplit | typeof RoomMode.PrivateCircle;

export type SerializedQuietBudgetRoom = {
  room: {
    id: string;
    title: string;
    organizer: Address;
    mode: number;
    status: number;
    submissionDeadline: string;
    memberCount: number;
    submissionCount: number;
    optionCount: number;
    finalizedOptionCount: number;
  };
  members: Address[];
  hasSubmitted: boolean;
  role: string;
  privateCircle?: { recipient: Address; access: number; collectionStatus: number; publicTarget: string; verifiedContributionCount: string; uniqueContributorCount: string; targetVersion: string };
};

export type RoomHistoryResult = {
  account: Address;
  snapshotBlock: string;
  rooms: SerializedQuietBudgetRoom[];
  partialError?: string;
};

export function normalizeRoomHistoryAccount(value: string | null) {
  if (!value || !isAddress(value, { strict: false })) {
    throw new RoomHistoryError("INVALID_ACCOUNT", "Use a valid wallet address.", 400);
  }
  return getAddress(value);
}

export async function discoverQuietBudgetRoomsForAccount({
  client,
  account,
  delay = defaultDelay,
}: {
  client: RoomHistoryClient;
  account: Address;
  delay?: (ms: number) => Promise<void>;
}): Promise<RoomHistoryResult> {
  return discoverRoomsForAccount({ client, account, mode: RoomMode.QuietBudget, delay });
}

export async function discoverRoomsForAccount({
  client,
  account,
  mode,
  delay = defaultDelay,
}: {
  client: RoomHistoryClient;
  account: Address;
  mode: RoomHistoryMode;
  delay?: (ms: number) => Promise<void>;
}): Promise<RoomHistoryResult> {
  const normalizedAccount = getAddress(account);
  const snapshotBlock = await client.getBlockNumber();
  const roomIds = await scanRoomIds({
    client,
    snapshotBlock,
    mode,
    delay,
  });
  const contributedRoomIds = mode === RoomMode.PrivateCircle
    ? await scanContributionRoomIdsForAccount({ client, snapshotBlock, account: normalizedAccount, delay })
    : new Set<bigint>();
  const rooms: SerializedQuietBudgetRoom[] = [];
  let readFailureCount = 0;

  for (const roomId of roomIds) {
    try {
      const reads: Promise<unknown>[] = [
        client.readContract({
          address: roomHistoryFairCircleAddress,
          abi: roomHistoryFairCircleAbi,
          functionName: "getRoom",
          args: [roomId],
        }),
        client.readContract({
          address: roomHistoryFairCircleAddress,
          abi: roomHistoryFairCircleAbi,
          functionName: "getMembers",
          args: [roomId],
        }),
        client.readContract({
          address: roomHistoryFairCircleAddress,
          abi: roomHistoryFairCircleAbi,
          functionName: "hasSubmitted",
          args: [roomId, normalizedAccount],
        }),
      ];
      if (mode === RoomMode.PrivateCircle) reads.push(client.readContract({ address: roomHistoryFairCircleAddress, abi: roomHistoryFairCircleAbi, functionName: "getPrivateCircle", args: [roomId] }));
      const [roomValue, membersValue, hasSubmittedValue, privateValue] = await Promise.all(reads);
      const room = normalizeServerRoomView(roomValue);
      if (room.mode !== mode) {
        continue;
      }
      const members = (membersValue as Address[]).map((member) => getAddress(member));
      const isOrganizer = getAddress(room.organizer) === normalizedAccount;
      const privateView = mode === RoomMode.PrivateCircle ? privateValue as { recipient: Address; access: number; collectionStatus: number; publicTarget: bigint; verifiedContributionCount: bigint; uniqueContributorCount: bigint; targetVersion: bigint } : undefined;
      const isMember = members.some((member) => getAddress(member) === normalizedAccount);
      const isRecipient = privateView ? getAddress(privateView.recipient) === normalizedAccount : false;
      const isContributor = contributedRoomIds.has(roomId);
      if (!isOrganizer && !isMember && !isRecipient && !isContributor) {
        continue;
      }
      rooms.push({
        room,
        members,
        hasSubmitted: Boolean(hasSubmittedValue),
        role: isOrganizer && isMember ? "Organizer and member" : isOrganizer ? "Organizer" : isRecipient && isMember ? "Recipient and member" : isRecipient && isContributor ? "Recipient and contributor" : isRecipient ? "Recipient" : isMember && isContributor ? "Member and contributor" : isMember ? "Member" : "Contributor",
        privateCircle: privateView ? { recipient: getAddress(privateView.recipient), access: Number(privateView.access), collectionStatus: Number(privateView.collectionStatus), publicTarget: BigInt(privateView.publicTarget).toString(), verifiedContributionCount: BigInt(privateView.verifiedContributionCount).toString(), uniqueContributorCount: BigInt(privateView.uniqueContributorCount).toString(), targetVersion: BigInt(privateView.targetVersion).toString() } : undefined,
      });
      if (rooms.length >= ROOM_HISTORY_MAX_ROOMS) {
        break;
      }
    } catch {
      readFailureCount += 1;
    }
  }

  return {
    account: normalizedAccount,
    snapshotBlock: snapshotBlock.toString(),
    rooms: rooms.sort((a, b) => Number(BigInt(b.room.id) - BigInt(a.room.id))),
    partialError: readFailureCount > 0
      ? "Some rooms could not be refreshed from the room-history provider."
      : undefined,
  };
}

async function scanContributionRoomIdsForAccount({ client, snapshotBlock, account, delay }: { client: RoomHistoryClient; snapshotBlock: bigint; account: Address; delay: (ms: number) => Promise<void> }) {
  const ids = new Set<bigint>(); let fromBlock = roomHistoryDeploymentBlock; let chunks = 0;
  while (fromBlock <= snapshotBlock) {
    chunks += 1; if (chunks > ROOM_HISTORY_MAX_CHUNKS) throw new RoomHistoryError("TOO_MUCH_HISTORY", "Room history is too large to scan in one request.", 413);
    const toBlock = fromBlock + ROOM_HISTORY_CHUNK_SIZE - 1n > snapshotBlock ? snapshotBlock : fromBlock + ROOM_HISTORY_CHUNK_SIZE - 1n;
    const events = await withRoomHistoryRetry(() => client.getContractEvents({ address: roomHistoryFairCircleAddress, abi: roomHistoryFairCircleAbi, eventName: "ContributionReceived", fromBlock, toBlock }), delay);
    for (const event of events) if (event.args.contributor && getAddress(event.args.contributor as Address) === account) ids.add(BigInt(event.args.roomId as bigint));
    fromBlock = toBlock + 1n;
  }
  return ids;
}

export async function scanQuietBudgetRoomIds({
  client,
  snapshotBlock,
  delay = defaultDelay,
}: {
  client: RoomHistoryClient;
  snapshotBlock: bigint;
  delay?: (ms: number) => Promise<void>;
}) {
  return scanRoomIds({ client, snapshotBlock, mode: RoomMode.QuietBudget, delay });
}

export async function scanRoomIds({
  client,
  snapshotBlock,
  mode,
  delay = defaultDelay,
}: {
  client: RoomHistoryClient;
  snapshotBlock: bigint;
  mode: RoomHistoryMode;
  delay?: (ms: number) => Promise<void>;
}) {
  const ids = new Set<bigint>();
  let fromBlock = roomHistoryDeploymentBlock;
  let chunkCount = 0;

  while (fromBlock <= snapshotBlock) {
    chunkCount += 1;
    if (chunkCount > ROOM_HISTORY_MAX_CHUNKS) {
      throw new RoomHistoryError(
        "TOO_MUCH_HISTORY",
        "Room history is too large to scan in one request.",
        413,
      );
    }
    const toBlock = fromBlock + ROOM_HISTORY_CHUNK_SIZE - 1n > snapshotBlock
      ? snapshotBlock
      : fromBlock + ROOM_HISTORY_CHUNK_SIZE - 1n;
    const events = await withRoomHistoryRetry(
      () =>
        client.getContractEvents({
          address: roomHistoryFairCircleAddress,
          abi: roomHistoryFairCircleAbi,
          eventName: mode === RoomMode.PrivateCircle ? "PrivateCircleCreated" : "RoomCreated",
          fromBlock,
          toBlock,
        }),
      delay,
    );
    for (const event of events) {
      const eventMode = mode === RoomMode.PrivateCircle ? RoomMode.PrivateCircle : Number(event.args.mode);
      const roomId = event.args.roomId;
      if (eventMode === mode && roomId !== undefined) {
        ids.add(BigInt(roomId as bigint));
      }
    }
    fromBlock = toBlock + 1n;
  }

  return Array.from(ids);
}

export async function withRoomHistoryRetry<T>(
  operation: () => Promise<T>,
  delay: (ms: number) => Promise<void> = defaultDelay,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < ROOM_HISTORY_MAX_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === ROOM_HISTORY_MAX_RETRIES - 1) {
        break;
      }
      await delay(500 * 2 ** attempt);
    }
  }
  if (isRateLimitError(lastError)) {
    throw new RoomHistoryError(
      "RATE_LIMITED",
      "The room-history provider is temporarily rate limited.",
      429,
    );
  }
  if (isHistoricalLogError(lastError)) {
    throw new RoomHistoryError(
      "HISTORY_UNAVAILABLE",
      "Historical Sepolia logs are unavailable from the configured provider.",
      502,
    );
  }
  throw new RoomHistoryError("FAILED", "Room history could not be loaded. Try again.", 502);
}

export function roomHistoryClientMessage(error: unknown) {
  if (error instanceof RoomHistoryError) {
    return error.message;
  }
  return "Room history could not be loaded. Try again.";
}

export function sanitizeRoomHistoryDiagnostic(error: unknown) {
  const raw = error instanceof Error && error.message.trim() !== ""
    ? error.message
    : String(error);
  return raw
    .replace(/https?:\/\/[^\s"')]+/gi, "[redacted-url]")
    .replace(/wss?:\/\/[^\s"')]+/gi, "[redacted-url]")
    .replace(/"body"\s*:\s*"[^"]*"/gi, '"body":"[redacted-body]"')
    .replace(/"headers"\s*:\s*\{[^}]*\}/gi, '"headers":"[redacted-headers]"')
    .replace(/eth_getLogs/gi, "[redacted-method]")
    .replace(/\b(api[_-]?key|token|authorization)=?[^&\s"']*/gi, "$1=[redacted]")
    .slice(0, 500);
}

function normalizeServerRoomView(value: unknown): SerializedQuietBudgetRoom["room"] {
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
    id: BigInt(room.id).toString(),
    title: room.title,
    organizer: getAddress(room.organizer),
    mode: Number(room.mode),
    status: Number(room.status),
    submissionDeadline: BigInt(room.submissionDeadline).toString(),
    memberCount: Number(room.memberCount),
    submissionCount: Number(room.submissionCount),
    optionCount: Number(room.optionCount),
    finalizedOptionCount: Number(room.finalizedOptionCount),
  };
}

function isRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate limit|too many requests/i.test(message);
}

function isHistoricalLogError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /archive|eth_getLogs|getLogs|block range|historical/i.test(message);
}

function defaultDelay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
