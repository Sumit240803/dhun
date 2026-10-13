// A DEVELOPMENT-ONLY PK simulator.
//
// The PK stage is built and the backend that feeds it is a milestone away, so
// without this the only way to look at the most important screen in the app is
// to imagine it. This produces a plausible battle and advances it on a tick —
// scores drift, the clock runs down, the whistle goes, a result shows.
//
// Every caller is behind `__DEV__` and the bundler strips the dead branch from
// a release build. It follows `devGifts.ts`, which exists for the same reason.

import type { PkState, PkSupporter } from './types';

const NAMES = ['Asha', 'Rohan', 'Meera', 'Kabir', 'Zoya', 'Nikhil', 'Priya', 'Arjun'];

function supporters(seed: number, count: number): PkSupporter[] {
  return Array.from({ length: count }, (_, index) => ({
    userId: `dev-sup-${seed}-${index}`,
    displayName: NAMES[(seed + index) % NAMES.length]!,
    avatarUrl: null,
    coins: Math.round(5_000 / (index + 1)),
  }));
}

/** A battle that has just kicked off. */
export function simulatePk(mode: PkState['mode'] = '1v1'): PkState {
  return {
    id: `dev-pk-${Date.now()}`,
    mode,
    phase: 'live',
    home: 0,
    endsAt: new Date(Date.now() + 3 * 60_000).toISOString(),
    winner: null,
    sides: [
      {
        userId: 'dev-host-left',
        roomId: 'dev-room-left',
        displayName: 'Meera',
        avatarUrl: null,
        score: 0,
        streak: 2,
        winMultiplier: 2,
        supporters: supporters(1, 4),
        team: mode === 'team' ? supporters(3, 5) : [],
      },
      {
        userId: 'dev-host-right',
        roomId: 'dev-room-right',
        displayName: 'Rohan',
        avatarUrl: null,
        score: 0,
        streak: 4,
        winMultiplier: 4,
        supporters: supporters(5, 4),
        team: mode === 'team' ? supporters(7, 5) : [],
      },
    ],
  };
}

/**
 * One tick of a running battle.
 *
 * Returns a NEW state — the stage re-renders from it, so mutating would show
 * nothing. Lopsided on purpose: an evenly matched simulation never exercises
 * the boundary clamp, which is the bit most likely to be wrong.
 */
export function advancePk(pk: PkState): PkState {
  if (pk.phase !== 'live') return pk;

  const left = pk.sides[0].score + Math.round(Math.random() * 800);
  const right = pk.sides[1].score + Math.round(Math.random() * 2_400);
  const secondsLeft = (new Date(pk.endsAt).getTime() - Date.now()) / 1000;

  if (secondsLeft <= 0) {
    return {
      ...pk,
      phase: 'result',
      endsAt: new Date(Date.now() + 8_000).toISOString(),
      winner: left === right ? null : left > right ? 0 : 1,
    };
  }

  return {
    ...pk,
    sides: [
      { ...pk.sides[0], score: left },
      { ...pk.sides[1], score: right },
    ],
  };
}
