const MAX_RPC_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 400;
const MAX_RETRY_DELAY_MS = 2_000;

export async function withTransientRpcRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RPC_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error) || attempt === MAX_RPC_RETRIES - 1) {
        throw error;
      }
      await delay(Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS));
    }
  }

  throw lastError;
}

export function isTransientRpcError(error: unknown) {
  const value = error as {
    code?: unknown;
    status?: unknown;
    shortMessage?: unknown;
    message?: unknown;
    cause?: { code?: unknown; status?: unknown; message?: unknown };
  };
  const code = value.code ?? value.cause?.code;
  const status = value.status ?? value.cause?.status;
  const message = String(value.shortMessage ?? value.message ?? value.cause?.message ?? error);

  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED") {
    return true;
  }
  if (typeof status === "number" && (status === 408 || status === 429 || status >= 500)) {
    return true;
  }
  return /(?:429|408|rate limit|too many requests|timeout|timed out|temporarily unavailable|network error|fetch failed|connection reset|connection refused|socket hang up|receipt.*not found)/i.test(message);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
