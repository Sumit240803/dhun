// The error taxonomy.
//
// Rule 3 of the engineering standards: a client gets a stable `code`, a short
// human message, and — for validation failures — field paths. It never gets SQL,
// schema names, file paths, stack traces, regex sources, or its own input echoed
// back. Everything else is logged against the trace_id and stays server-side.

/**
 * Every deliberate failure in the system.
 *
 * `details` is the ONLY thing that reaches the client alongside code and message,
 * so nothing may be put there that the caller should not see. Anything diagnostic
 * goes in `internal`, which is logged and never serialised.
 */
export class AppError extends Error {
  /**
   * Whether `message` may be shown to the caller.
   *
   * Defaults to true below 500 and false at or above it, which is the right call
   * almost always: a 4xx tells the caller something actionable, while a 5xx
   * message describes our internals. Errors that are genuinely a 5xx but still
   * safe to explain — "temporarily unavailable", "service busy" — opt back in.
   *
   * When false, the ORIGINAL message still reaches the logs; only the client
   * gets the generic substitute.
   */
  public expose: boolean;

  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: Record<string, unknown>,
    public internal?: Record<string, unknown>,
    expose?: boolean,
  ) {
    super(message);
    this.name = new.target.name;
    this.expose = expose ?? status < 500;
  }
}

/** Shown in place of any message that must not leave the server. */
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

// --- authentication & authorisation -----------------------------------------

export class UnauthenticatedError extends AppError {
  constructor(reason = 'Missing bearer token') {
    super('UNAUTHENTICATED', reason, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that', details?: Record<string, unknown>) {
    super('FORBIDDEN', message, 403, details);
  }
}

// --- request shape ----------------------------------------------------------

export interface FieldIssue {
  field: string;
  code: string;
  message: string;
}

/** Field paths and safe messages only — never the offending value. */
export class ValidationError extends AppError {
  constructor(issues: FieldIssue[]) {
    super('VALIDATION_FAILED', 'Some fields are invalid', 422, { issues });
  }
}

export class BadJsonError extends AppError {
  constructor() {
    super('BAD_JSON', 'Request body is not valid JSON', 400);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor() {
    super('PAYLOAD_TOO_LARGE', 'Request body is too large', 413);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor() {
    super('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json', 415);
  }
}

/**
 * A JSON body carrying `__proto__`, `constructor` or `prototype` as a key.
 *
 * There is no legitimate reason for a client to send these, and accepting them is
 * how prototype-pollution bugs turn into remote code execution.
 */
export class UnsafePayloadError extends AppError {
  constructor(key: string) {
    super('UNSAFE_PAYLOAD', 'Request contains a disallowed property name', 400, { key });
  }
}

// --- throttling -------------------------------------------------------------

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number, scope: string) {
    super('RATE_LIMITED', 'Too many requests. Please slow down.', 429, {
      retryAfterSeconds,
      scope,
    });
  }
}

// --- money ------------------------------------------------------------------

export class InsufficientBalanceError extends AppError {
  constructor(accountCode: string, available: number, requested: number) {
    super('INSUFFICIENT_BALANCE', 'Not enough balance', 402, {
      account: accountCode,
      available,
      requested,
    });
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor(key: string) {
    super(
      'IDEMPOTENCY_KEY_REUSED',
      'This idempotency key was used for a different operation',
      422,
      {},
      { idempotencyKey: key },
    );
  }
}

export class RequestInProgressError extends AppError {
  constructor(key: string) {
    super('REQUEST_IN_PROGRESS', 'An identical request is still in progress', 409, {}, {
      idempotencyKey: key,
    });
  }
}

/** The money-layer kill switch: a transaction type has been switched off. */
export class TxnTypeInactiveError extends AppError {
  constructor(txnType: string) {
    super('TXN_TYPE_INACTIVE', 'That feature is temporarily unavailable', 503, {}, { txnType }, true);
  }
}

/** Caught in application code; the database enforces this again at COMMIT. */
export class UnbalancedTransactionError extends AppError {
  constructor(unit: string, total: number) {
    super(
      'UNBALANCED_TRANSACTION',
      `Ledger legs for unit "${unit}" sum to ${total}, must be 0`,
      500,
      undefined,
      { unit, total },
    );
  }
}

export class UnknownAccountError extends AppError {
  constructor(code: string) {
    super(
      'UNKNOWN_ACCOUNT',
      `No account template or system account named "${code}"`,
      500,
      undefined,
      { account: code },
    );
  }
}

// --- infrastructure ---------------------------------------------------------

/** Deadlock, serialisation failure, or a lost connection. The client may retry. */
export class TransientDatabaseError extends AppError {
  constructor(internal?: Record<string, unknown>) {
    super('SERVICE_UNAVAILABLE', 'Service is busy. Please try again.', 503, undefined, internal, true);
  }
}

export class QueryTimeoutError extends AppError {
  constructor(internal?: Record<string, unknown>) {
    super('TIMEOUT', 'That took too long. Please try again.', 504, undefined, internal, true);
  }
}

/**
 * Maps a raw driver error onto the taxonomy.
 *
 * Without this, a constraint violation surfaces as a 500 carrying the constraint
 * name — which leaks the schema — or worse, as an unhandled rejection.
 */
const PG_CODES: Record<string, (e: PgError) => AppError> = {
  // Not mapped to 409 blindly: an idempotency-key collision is handled upstream,
  // so anything reaching here is a genuine conflict the caller can act on.
  '23505': (e) => new AppError('CONFLICT', 'That already exists', 409, undefined, {
    constraint: e.constraint,
  }),
  '23503': (e) => new AppError('INVALID_REFERENCE', 'A referenced item does not exist', 422, undefined, {
    constraint: e.constraint,
  }),
  '23514': (e) => new AppError('CONSTRAINT_VIOLATION', 'That value is not allowed', 422, undefined, {
    constraint: e.constraint,
  }),
  '23502': (e) => new AppError('MISSING_FIELD', 'A required value is missing', 422, undefined, {
    column: e.column,
  }),
  '22001': () => new AppError('VALUE_TOO_LONG', 'A value is too long', 422),
  '22003': () => new AppError('VALUE_OUT_OF_RANGE', 'A value is out of range', 422),
  '40001': (e) => new TransientDatabaseError({ pg: e.code }), // serialization_failure
  '40P01': (e) => new TransientDatabaseError({ pg: e.code }), // deadlock_detected
  '55P03': (e) => new TransientDatabaseError({ pg: e.code }), // lock_not_available
  '57014': (e) => new QueryTimeoutError({ pg: e.code }), // query_canceled
  '53300': (e) => new TransientDatabaseError({ pg: e.code }), // too_many_connections
};

interface PgError {
  code?: string;
  constraint?: string;
  column?: string;
  table?: string;
  message?: string;
}

export function mapDatabaseError(err: unknown): AppError | undefined {
  const e = err as PgError;
  if (!e?.code || typeof e.code !== 'string') return undefined;

  const mapped = PG_CODES[e.code];
  if (mapped) return mapped(e);

  // Class 08 — connection exception. The pool is unhealthy, not the request.
  if (e.code.startsWith('08')) return new TransientDatabaseError({ pg: e.code });

  return undefined;
}
