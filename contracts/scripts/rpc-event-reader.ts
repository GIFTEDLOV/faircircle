import type { Abi, Address, Hex } from "viem";

export type HistoricalEventLog = {
  transactionHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  args?: Record<string, unknown>;
};

export type HistoricalEventReaderClient = {
  getContractEvents(parameters: {
    address: Address;
    abi: Abi;
    eventName: string;
    args: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<HistoricalEventLog[]>;
};

export type HistoricalEventReaderOptions = {
  chunkSize?: bigint;
  minDelayMs?: number;
  maxAttempts?: number;
  retryBackoffMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  logger?: (message: string) => void;
  now?: () => number;
};

export type ReadEventsParameters = {
  address: Address;
  abi: Abi;
  eventName: string;
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
};

const DEFAULT_CHUNK_SIZE = 1_000n;
const DEFAULT_MIN_DELAY_MS = 1_000;
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000, 30_000] as const;

export class HistoricalEventReader {
  readonly #client: HistoricalEventReaderClient;
  readonly #chunkSize: bigint;
  readonly #minDelayMs: number;
  readonly #maxAttempts: number;
  readonly #retryBackoffMs: readonly number[];
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #logger: (message: string) => void;
  readonly #now: () => number;
  readonly #cache = new Map<string, HistoricalEventLog[]>();
  #lastRequestAt = 0;

  constructor(
    client: HistoricalEventReaderClient,
    options: HistoricalEventReaderOptions = {},
  ) {
    this.#client = client;
    this.#chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.#minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#retryBackoffMs = options.retryBackoffMs ?? DEFAULT_BACKOFF_MS;
    this.#sleep = options.sleep ?? sleep;
    this.#logger = options.logger ?? console.log;
    this.#now = options.now ?? Date.now;
  }

  async readEvents(parameters: ReadEventsParameters) {
    const cacheKey = eventCacheKey(parameters);
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined) {
      return [...cached];
    }

    const logs: HistoricalEventLog[] = [];
    for (const range of blockChunks(
      parameters.fromBlock,
      parameters.toBlock,
      this.#chunkSize,
    )) {
      logs.push(...await this.#readChunk(parameters, range.fromBlock, range.toBlock));
    }

    const ordered = dedupeAndSortLogs(logs);
    this.#cache.set(cacheKey, ordered);
    return [...ordered];
  }

  async #readChunk(
    parameters: ReadEventsParameters,
    fromBlock: bigint,
    toBlock: bigint,
  ) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      await this.#throttle();
      try {
        return await this.#client.getContractEvents({
          address: parameters.address,
          abi: parameters.abi,
          eventName: parameters.eventName,
          args: parameters.args ?? {},
          fromBlock,
          toBlock,
        });
      } catch (error) {
        lastError = error;
        if (!isRateLimitError(error) || attempt === this.#maxAttempts) {
          break;
        }
        const retryDelay = retryDelayMs(error, attempt, this.#retryBackoffMs);
        this.#logger(
          `eth_getLogs ${parameters.eventName} blocks ${fromBlock.toString()}-${toBlock.toString()} rate-limited; retry ${attempt + 1}/${this.#maxAttempts} after ${retryDelay}ms`,
        );
        await this.#sleep(retryDelay);
      }
    }

    throw new Error(
      `eth_getLogs ${parameters.eventName} blocks ${fromBlock.toString()}-${toBlock.toString()} failed after ${this.#maxAttempts} attempts: ${safeErrorMessage(lastError)}`,
    );
  }

  async #throttle() {
    if (this.#lastRequestAt !== 0 && this.#minDelayMs > 0) {
      const elapsed = this.#now() - this.#lastRequestAt;
      if (elapsed < this.#minDelayMs) {
        await this.#sleep(this.#minDelayMs - elapsed);
      }
    }
    this.#lastRequestAt = this.#now();
  }
}

export function dedupeAndSortLogs(logs: readonly HistoricalEventLog[]) {
  const seen = new Set<string>();
  const unique: HistoricalEventLog[] = [];
  for (const log of logs) {
    const key = `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(log);
  }

  return unique.sort((a, b) => {
    if (a.blockNumber === b.blockNumber) {
      return a.logIndex - b.logIndex;
    }
    return a.blockNumber < b.blockNumber ? -1 : 1;
  });
}

export function blockChunks(fromBlock: bigint, toBlock: bigint, chunkSize: bigint) {
  if (chunkSize <= 0n) {
    throw new Error("Historical event chunk size must be greater than zero.");
  }
  if (fromBlock > toBlock) {
    return [];
  }

  const chunks: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n;
    chunks.push({ fromBlock: start, toBlock: end > toBlock ? toBlock : end });
  }
  return chunks;
}

export function isRateLimitError(error: unknown) {
  const candidate = error as {
    status?: number;
    statusCode?: number;
    code?: number | string;
    message?: string;
    shortMessage?: string;
    details?: string;
  };
  const text = [
    candidate.message,
    candidate.shortMessage,
    candidate.details,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase();

  return (
    candidate.status === 429 ||
    candidate.statusCode === 429 ||
    candidate.code === 429 ||
    candidate.code === "429" ||
    candidate.code === -32005 ||
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("rate limit") ||
    text.includes("request limit") ||
    text.includes("exceeded") ||
    text.includes("throttle")
  );
}

export function retryDelayMs(
  error: unknown,
  attempt: number,
  backoffMs: readonly number[] = DEFAULT_BACKOFF_MS,
) {
  const retryAfter = retryAfterMs(error);
  if (retryAfter !== undefined) {
    return retryAfter;
  }
  return backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 30_000;
}

export function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim() !== "") {
    return redactSecrets(error.message);
  }
  return "unknown provider error";
}

function eventCacheKey(parameters: ReadEventsParameters) {
  return JSON.stringify({
    address: parameters.address.toLowerCase(),
    eventName: parameters.eventName,
    args: normalizeForKey(parameters.args ?? {}),
    fromBlock: parameters.fromBlock.toString(),
    toBlock: parameters.toBlock.toString(),
  });
}

function normalizeForKey(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForKey);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalizeForKey(item)]),
    );
  }
  return value;
}

function retryAfterMs(error: unknown) {
  const header = retryAfterHeader(error);
  if (header === undefined) {
    return undefined;
  }

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1_000));
  }

  const date = Date.parse(header);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, date - Date.now());
}

function retryAfterHeader(error: unknown) {
  const candidate = error as {
    headers?: Record<string, string | undefined> | { get(name: string): string | null };
    response?: {
      headers?: Record<string, string | undefined> | { get(name: string): string | null };
    };
  };
  return headerValue(candidate.headers) ?? headerValue(candidate.response?.headers);
}

function headerValue(
  headers: Record<string, string | undefined> | { get(name: string): string | null } | undefined,
) {
  if (headers === undefined) {
    return undefined;
  }
  if ("get" in headers) {
    return headers.get("retry-after") ?? undefined;
  }
  return headers["retry-after"] ?? headers["Retry-After"];
}

function redactSecrets(message: string) {
  return message
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
