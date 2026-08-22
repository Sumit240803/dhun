import { Unit } from '../../shared/types.js';

/**
 * Rates frozen onto every transaction at write time.
 *
 * The economy docs plan to retune all of these about three months after launch.
 * Without freezing them, one config change would silently rewrite the meaning of
 * every historical entry and break every reconciliation check.
 * See ledger-decisions.md § G1.
 */
export interface FrozenRates {
  faceValueUnitsPerRupee: number;
  pointsPerRupee: number;
  payoutRateBp?: number;
  coinToGemRateBp?: number;
}

/** One leg of a transaction. `amount` is signed and must never be zero. */
export interface Leg {
  accountCode: string;
  /** Required for user/host accounts, omitted for system accounts. */
  scopeId?: string;
  unit: Unit;
  amount: number;
}

/** Written inside the same transaction as the entries — see § B8. */
export interface OutboxEvent {
  eventType: string;
  partitionKey: string;
  payload: Record<string, unknown>;
}

export interface PostTxnInput {
  txnType: string;
  idempotencyKey: string;
  /**
   * What this key is bound to — e.g. `{ gift_id, host_id, room_id, quantity }`.
   * A replay carrying a different identity is rejected, not silently ignored.
   */
  identity: Record<string, unknown>;
  rates: FrozenRates;
  legs: Leg[];
  events?: OutboxEvent[];
  actorUserId?: string;
  memo?: string;
  reversesTxnId?: string;
  /** Returned verbatim on a replay. */
  response?: Record<string, unknown>;
}

export interface PostTxnResult {
  txnId: string;
  /** True when this returned a previously completed transaction unchanged. */
  replayed: boolean;
  response: Record<string, unknown>;
}
