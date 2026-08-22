// The HTTP client.
//
// Three things here are load-bearing and easy to get subtly wrong:
//
//   1. **Single-flight token refresh.** Five parallel requests hitting 401 must
//      trigger ONE refresh, not five. Five would rotate the refresh token five
//      times, and the backend treats a replayed refresh token as theft — it
//      would revoke the whole device chain and sign the user out.
//   2. **Idempotency keys come from the CALLER**, generated once when the user
//      taps and reused for every retry. A key made per request is useless.
//   3. **Retries are bounded and only for safe cases.** A 429 or 503 with an
//      Idempotency-Key is safe to retry; a 500 without one is not.

import Constants from 'expo-constants';
import { ApiErrorBody, ApiErrorCode, FieldIssue, TokenPair } from './types';

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://localhost:3000';

const API_VERSION = 'v1';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: Record<string, unknown>,
    public traceId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level problems, when the failure was a validation error. */
  get issues(): FieldIssue[] {
    return (this.details?.issues as FieldIssue[]) ?? [];
  }

  /** The message to put in front of a user. Server text is already sanitised. */
  get userMessage(): string {
    if (this.code === ApiErrorCode.NETWORK_ERROR) {
      return 'No connection. Check your network and try again.';
    }
    return this.message;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * Required by every endpoint that moves money.
   *
   * Generate it ONCE when the user taps, persist it, and pass the same value on
   * every retry of that same intent.
   */
  idempotencyKey?: string;
  /** Skip the Authorization header — used by the auth endpoints themselves. */
  anonymous?: boolean;
  signal?: AbortSignal;
  /** Overrides the default retry budget for this call. */
  retries?: number;
}

type TokenGetter = () => Promise<string | null>;
type RefreshHandler = () => Promise<TokenPair | null>;
type SessionEndedHandler = (reason: string) => void;

let getAccessToken: TokenGetter = async () => null;
let refreshTokens: RefreshHandler = async () => null;
let onSessionEnded: SessionEndedHandler = () => undefined;

/** Wired once by the auth provider, so this module never imports React state. */
export function configureApiClient(handlers: {
  getAccessToken: TokenGetter;
  refreshTokens: RefreshHandler;
  onSessionEnded: SessionEndedHandler;
}): void {
  getAccessToken = handlers.getAccessToken;
  refreshTokens = handlers.refreshTokens;
  onSessionEnded = handlers.onSessionEnded;
}

/**
 * The in-flight refresh, if any.
 *
 * Every 401 awaits this same promise rather than starting its own refresh —
 * which is what keeps the backend's replay detection from firing on us.
 */
let refreshInFlight: Promise<TokenPair | null> | null = null;

async function refreshOnce(): Promise<TokenPair | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshTokens().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function uuid(): string {
  // globalThis.crypto is available on Hermes with RN 0.86.
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function parseError(res: Response, traceId: string): Promise<ApiError> {
  let body: ApiErrorBody | undefined;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // A non-JSON error body means something between us and the API responded —
    // a proxy, a captive portal. Do not surface its HTML.
  }

  return new ApiError(
    body?.error?.code ?? `HTTP_${res.status}`,
    body?.error?.message ?? 'Something went wrong. Please try again.',
    res.status,
    body?.error?.details,
    body?.error?.trace_id ?? traceId,
  );
}

/** Safe to retry only when the request is idempotent or provably had no effect. */
function isRetryable(status: number, hasIdempotencyKey: boolean, method: string): boolean {
  if (status === 429) return true;
  if (status === 503 || status === 504) return true;
  // A 5xx on a mutation may have partially applied. Retrying is only safe when
  // an idempotency key guarantees the server will collapse the duplicate.
  if (status >= 500) return method === 'GET' || hasIdempotencyKey;
  return false;
}

function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get('Retry-After');
  const advertised = header ? Number(header) * 1000 : NaN;
  if (Number.isFinite(advertised) && advertised > 0) return Math.min(advertised, 30_000);
  // Exponential backoff with jitter, so a fleet of clients recovering from an
  // outage does not stampede the API in lockstep.
  return Math.min(2 ** attempt * 500, 8_000) + Math.random() * 250;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, anonymous = false, signal } = options;
  const maxRetries = options.retries ?? 2;

  const url = `${BASE_URL}/${path.startsWith(API_VERSION) ? '' : `${API_VERSION}/`}${path}`.replace(
    /([^:]\/)\/+/g,
    '$1',
  );

  let refreshedAlready = false;

  for (let attempt = 0; ; attempt++) {
    const traceId = uuid();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Trace-Id': traceId,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    if (!anonymous) {
      const token = await getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (attempt < maxRetries) {
        await sleep(retryDelayMs(new Response(), attempt));
        continue;
      }
      throw new ApiError(
        ApiErrorCode.NETWORK_ERROR,
        'No connection. Check your network and try again.',
        0,
        undefined,
        traceId,
      );
    }

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }

    // 401 once: refresh, then replay the original request. Only once — a second
    // 401 after a fresh token means the session is genuinely over.
    if (res.status === 401 && !anonymous && !refreshedAlready) {
      refreshedAlready = true;
      const refreshed = await refreshOnce();
      if (refreshed) continue;

      const error = await parseError(res, traceId);
      onSessionEnded(error.code);
      throw error;
    }

    const error = await parseError(res, traceId);

    // The backend revoked the whole device chain because a refresh token was
    // replayed. There is nothing to retry — the user must sign in again.
    if (error.code === ApiErrorCode.REFRESH_TOKEN_REUSED) {
      onSessionEnded(error.code);
      throw error;
    }

    if (attempt < maxRetries && isRetryable(res.status, Boolean(idempotencyKey), method)) {
      await sleep(retryDelayMs(res, attempt));
      continue;
    }

    throw error;
  }
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),

  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
};

export { BASE_URL };
