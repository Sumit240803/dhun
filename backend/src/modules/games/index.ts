// PUBLIC API of the games module.
//
// Scope: in-room interactive formats only — live quiz, karaoke, PK battle,
// polls. All Phase 1; see docs/build-plan.md.
//
// HARD RULE #1: no paid chance-based game, ever. No lucky boxes, mystery gifts,
// wheels that cost coins to spin, and no RNG-settled stakes. India's Promotion
// and Regulation of Online Gaming Act 2025 bans online money games and erased
// the skill-versus-chance distinction. This is treated as an existential risk,
// so nothing in this module may settle a wager through the economy module.
//
// PK battles honour that by being a SCOREBOARD and nothing else: every gift
// counted was already paid to the host it was addressed to, by `gifting`,
// through the ledger, when it was sent. Nothing here calls `economy`, and the
// day something does is the day this module has become a betting product.
// Migration 028's header has the long version.

export { buildPkRouter } from './pk.routes.js';
export {
  battleForRoom,
  byId as pkBattleById,
  endBattlesForRoom,
  onGiftToHost as pkOnGiftToHost,
  settle as settlePkBattle,
} from './pk.service.js';
export type { PkBattleView, PkSideView, PkSupporterView } from './pk.service.js';
export { pkConfig } from './pk.config.js';
export type { PkConfig } from './pk.config.js';
export { matchPkQueue, settleDuePkBattles, expirePkInvites } from './pk.jobs.js';
