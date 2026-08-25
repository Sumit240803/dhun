// Promotional banners above the feed.
//
// TODO(api): GET /v1/config/banners — M10. Server-driven from day one
// (non-negotiable #6): a campaign must never need an app release, and a bad
// banner must be killable in seconds.
//
// ⚠️ HARD RULE #1 lives here. Events may be RANKINGS — who sent or received the
// most, over a window, with prizes from a published pool. They may never be
// chance: no lucky box, no mystery gift, no wheel, no "provably fair" anything.
// The reference app we are modelling ships a "Lucky Gift Ranking"; the ranking
// half is fine and the word is not, because it invites exactly the feature that
// the Online Gaming Act 2025 makes existential. Nothing here is named lucky.

export interface MockBanner {
  id: string;
  title: string;
  /** Second line. Dates, prize pool, or what to do. */
  subtitle: string;
  /** ISO 8601, or null for an evergreen banner. Drives the countdown. */
  endsAt: string | null;
  /**
   * Where tapping goes. A route string the client resolves — never a raw URL,
   * so a compromised config cannot open an arbitrary page inside the app.
   */
  action: 'ranking' | 'rewards' | 'topup' | 'none';
  /** Which gradient to paint. The server picks; the client owns the palette. */
  theme: 'gold' | 'rose' | 'violet';
}

const BANNERS: MockBanner[] = [
  {
    id: 'b_pk',
    title: 'Gifting Points Ranking',
    subtitle: 'Top hosts this week share a ₹2,00,000 pool',
    endsAt: '2026-08-31T23:59:00+05:30',
    action: 'ranking',
    theme: 'gold',
  },
  {
    id: 'b_newuser',
    title: 'New here? Collect your rewards',
    subtitle: 'Daily check-in, first follow and more — free coins',
    endsAt: '2026-09-01T23:59:00+05:30',
    action: 'rewards',
    theme: 'rose',
  },
  {
    id: 'b_starter',
    title: 'Starter pack — ₹19',
    subtitle: '2,000 coins and 3,300 gems, once per account',
    endsAt: null,
    action: 'topup',
    theme: 'violet',
  },
];

export function mockBanners(): MockBanner[] {
  return BANNERS;
}
