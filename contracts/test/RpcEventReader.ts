import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Abi, Address, Hex } from "viem";
import {
  HistoricalEventReader,
  type HistoricalEventLog,
  type HistoricalEventReaderClient,
} from "../scripts/rpc-event-reader.js";

const abi = [] as unknown as Abi;
const address = "0x0000000000000000000000000000000000000001" as const satisfies Address;

describe("rate-limit-aware historical event reader", () => {
  it("retries HTTP 429 and returns logs after success", async () => {
    const sleeps: number[] = [];
    const client = mockClient([
      rateLimitError(),
      [log("0x0000000000000000000000000000000000000000000000000000000000000001", 10n, 0)],
    ]);
    const reader = readerFor(client, { sleeps });

    const logs = await readPlanCompleted(reader);

    assert.equal(logs.length, 1);
    assert.deepEqual(sleeps, [2_000]);
    assert.equal(client.calls.length, 2);
  });

  it("uses exponential backoff for repeated 429 responses", async () => {
    const sleeps: number[] = [];
    const client = mockClient([
      rateLimitError(),
      rateLimitError(),
      rateLimitError(),
      [log("0x0000000000000000000000000000000000000000000000000000000000000002", 10n, 0)],
    ]);
    const reader = readerFor(client, { sleeps });

    await readPlanCompleted(reader);

    assert.deepEqual(sleeps, [2_000, 4_000, 8_000]);
    assert.equal(client.calls.length, 4);
  });

  it("fails precisely after retry exhaustion", async () => {
    const client = mockClient([rateLimitError(), rateLimitError(), rateLimitError()]);
    const reader = readerFor(client, { maxAttempts: 3 });

    await assert.rejects(
      readPlanCompleted(reader),
      /eth_getLogs PlanCompleted blocks 1-10 failed after 3 attempts/,
    );
    assert.equal(client.calls.length, 3);
  });

  it("scans block ranges in bounded chunks sequentially", async () => {
    const client = mockClient([[], [], []]);
    const reader = readerFor(client, { chunkSize: 1_000n });

    await reader.readEvents({
      address,
      abi,
      eventName: "PlanCompleted",
      args: { planId: 1n },
      fromBlock: 1n,
      toBlock: 2_500n,
    });

    assert.deepEqual(
      client.calls.map(({ fromBlock, toBlock }) => [fromBlock, toBlock]),
      [
        [1n, 1_000n],
        [1_001n, 2_000n],
        [2_001n, 2_500n],
      ],
    );
  });

  it("returns logs in deterministic order", async () => {
    const client = mockClient([
      [
        log("0x0000000000000000000000000000000000000000000000000000000000000003", 12n, 1),
        log("0x0000000000000000000000000000000000000000000000000000000000000004", 11n, 4),
        log("0x0000000000000000000000000000000000000000000000000000000000000005", 11n, 2),
      ],
    ]);
    const reader = readerFor(client);

    const logs = await readPlanCompleted(reader);

    assert.deepEqual(
      logs.map(({ transactionHash }) => transactionHash),
      [
        "0x0000000000000000000000000000000000000000000000000000000000000005",
        "0x0000000000000000000000000000000000000000000000000000000000000004",
        "0x0000000000000000000000000000000000000000000000000000000000000003",
      ],
    );
  });

  it("deduplicates logs by transaction hash and log index", async () => {
    const duplicate = log(
      "0x0000000000000000000000000000000000000000000000000000000000000006",
      10n,
      1,
    );
    const client = mockClient([[duplicate, duplicate]]);
    const reader = readerFor(client);

    const logs = await readPlanCompleted(reader);

    assert.equal(logs.length, 1);
  });

  it("reuses cached event queries, including recovered plan and contribution evidence", async () => {
    const client = mockClient([
      [log("0x0000000000000000000000000000000000000000000000000000000000000007", 10n, 0)],
      [log("0x0000000000000000000000000000000000000000000000000000000000000008", 11n, 0)],
    ]);
    const reader = readerFor(client);

    await readPlanCompleted(reader);
    await readPlanCompleted(reader);
    await reader.readEvents({
      address,
      abi,
      eventName: "ContributionReceived",
      args: { roomId: 3n },
      fromBlock: 1n,
      toBlock: 10n,
    });
    await reader.readEvents({
      address,
      abi,
      eventName: "ContributionReceived",
      args: { roomId: 3n },
      fromBlock: 1n,
      toBlock: 10n,
    });

    assert.deepEqual(
      client.calls.map(({ eventName }) => eventName),
      ["PlanCompleted", "ContributionReceived"],
    );
  });

  it("does not include secret-bearing RPC URLs in errors or retry logs", async () => {
    const messages: string[] = [];
    const client = mockClient([
      rateLimitError(
        "HTTP 429 Too Many Requests from https://rpc.example/secret-api-key-1234567890abcdef",
      ),
    ]);
    const reader = readerFor(client, {
      logger: (message) => messages.push(message),
      maxAttempts: 1,
    });

    await assert.rejects(async () => {
      await readPlanCompleted(reader);
    }, (error) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.equal(message.includes("https://rpc.example"), false);
      assert.equal(message.includes("secret-api-key"), false);
      return true;
    });
    assert.equal(messages.join("\n").includes("https://rpc.example"), false);
    assert.equal(messages.join("\n").includes("secret-api-key"), false);
  });
});

function readerFor(
  client: ReturnType<typeof mockClient>,
  options: {
    sleeps?: number[];
    chunkSize?: bigint;
    maxAttempts?: number;
    logger?: (message: string) => void;
  } = {},
) {
  return new HistoricalEventReader(client, {
    chunkSize: options.chunkSize,
    minDelayMs: 0,
    maxAttempts: options.maxAttempts,
    sleep: async (ms) => {
      options.sleeps?.push(ms);
    },
    logger: options.logger ?? (() => undefined),
  });
}

function readPlanCompleted(reader: HistoricalEventReader) {
  return reader.readEvents({
    address,
    abi,
    eventName: "PlanCompleted",
    args: { planId: 1n },
    fromBlock: 1n,
    toBlock: 10n,
  });
}

function mockClient(results: Array<HistoricalEventLog[] | Error>) {
  const calls: Array<{
    eventName: string;
    fromBlock: bigint;
    toBlock: bigint;
  }> = [];
  let index = 0;
  const client: HistoricalEventReaderClient & { calls: typeof calls } = {
    calls,
    async getContractEvents(parameters) {
      calls.push({
        eventName: parameters.eventName,
        fromBlock: parameters.fromBlock,
        toBlock: parameters.toBlock,
      });
      const result = results[index];
      index += 1;
      if (result instanceof Error) {
        throw result;
      }
      return result ?? [];
    },
  };
  return client;
}

function rateLimitError(message = "HTTP 429 Too Many Requests") {
  return Object.assign(new Error(message), { status: 429 });
}

function log(transactionHash: Hex, blockNumber: bigint, logIndex: number) {
  return {
    transactionHash,
    blockNumber,
    logIndex,
    args: {},
  } satisfies HistoricalEventLog;
}
