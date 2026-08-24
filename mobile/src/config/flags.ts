// Feature flags and kill switches — the client half of day-1 non-negotiable #5.
//
// The server already owns the money-layer switch: `ledger_txn_types.is_active`
// stops a flow atomically with no deploy. This covers everything else — a feature
// that is misbehaving, a screen that must be hidden during review, a rollout that
// needs to be staged.
//
// Defaults are LOCAL and conservative. Remote values arrive from the server config
// endpoint and override them, so a bad flag can be corrected without a release —
// which is the entire point of having flags rather than build constants.

export interface Flags {
  /** Master switch. Off = the gift sheet is hidden and sends are refused client-side. */
  giftingEnabled: boolean;
  /** In-app purchases. Off during store review if billing is misbehaving. */
  purchasesEnabled: boolean;
  /** Web recharge portal link. NEVER default true — a purchase within 24 hours of
   *  an in-app link click still incurs Google's 20% fee. */
  showWebRechargeLink: boolean;
  /** Coins to gems. Off if the conversion rate is being retuned. */
  conversionEnabled: boolean;
  /** Live video rooms. Audio-only rooms stay available when off. */
  videoRoomsEnabled: boolean;
  /** Hindi UI. Lets the translation ship dark and be enabled per cohort. */
  hindiEnabled: boolean;

  /**
   * Social sign-in buttons on the login screen.
   *
   * The kill switch for a provider outage — if Facebook's SDK starts failing at
   * 3am, this hides the button without a release. It does NOT gate whether the
   * backend exists: that is `MOCK` in features/auth/social.ts.
   */
  socialLoginEnabled: boolean;
}

const defaults: Flags = {
  giftingEnabled: true,
  purchasesEnabled: true,
  showWebRechargeLink: false,
  conversionEnabled: true,
  videoRoomsEnabled: false,
  hindiEnabled: true,
  socialLoginEnabled: true,
};

let flags: Flags = { ...defaults };
const listeners = new Set<() => void>();

/** Applies remote overrides. Unknown keys are ignored, so an older client is never
 *  broken by a flag added for a newer one. */
export function applyRemoteFlags(remote: Partial<Flags>): void {
  const next: Flags = { ...flags };
  for (const key of Object.keys(defaults) as (keyof Flags)[]) {
    if (typeof remote[key] === 'boolean') next[key] = remote[key] as boolean;
  }
  flags = next;
  for (const listener of listeners) listener();
}

export function getFlags(): Flags {
  return flags;
}

export function isEnabled(flag: keyof Flags): boolean {
  return flags[flag];
}

export function subscribeToFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
