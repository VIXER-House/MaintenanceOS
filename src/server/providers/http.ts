export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
  }
}

/** Short human-readable reason from a provider's JSON error body (never includes request secrets). */
function providerDetail(text: string): string {
  try {
    const j = JSON.parse(text);
    const msg = j?.error?.message ?? j?.message ?? (typeof j?.error === "string" ? j.error : null);
    return msg ? `: ${String(msg).slice(0, 200)}` : "";
  } catch {
    return "";
  }
}

/** fetch with timeout + JSON handling, shared by all HTTP-based providers */
export async function fetchJson<T = unknown>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 20000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new ProviderHttpError(`HTTP ${res.status} from ${new URL(url).host}${providerDetail(text)}`, res.status, text.slice(0, 500));
    return (text ? JSON.parse(text) : {}) as T;
  } catch (e) {
    if (e instanceof ProviderHttpError) throw e;
    if ((e as Error).name === "AbortError") throw new ProviderHttpError(`Timeout after ${timeoutMs}ms calling ${new URL(url).host}`);
    throw new ProviderHttpError(`Network error calling ${new URL(url).host}: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Retry an async operation with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, retries = 1, baseDelayMs = 400): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // Don't retry client errors (bad key, bad request)
      if (e instanceof ProviderHttpError && e.status && e.status >= 400 && e.status < 500 && e.status !== 429) break;
      if (attempt < retries) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastErr;
}
