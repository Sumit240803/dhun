// The shapes the rewards and discovery screens draw, computed without React.

import type { ColdStartConfig, RewardsStatus } from '@/api/types';

export type LadderState = 'claimed' | 'today' | 'upcoming';

/**
 * The seven check-in days as the ladder shows them.
 *
 * Before today's claim: days below today's are the streak so far, today is the
 * one to tap. After it: today is claimed too. A streak that just wrapped past
 * day 7 starts the row fresh — nothing ticked, day 1 waiting.
 */
export function ladderDays(
  checkin: RewardsStatus['checkin'],
): { day: number; coins: number; state: LadderState }[] {
  return checkin.ladder.map((coins, index) => {
    const day = index + 1;
    const state: LadderState =
      day < checkin.streakDay
        ? 'claimed'
        : day === checkin.streakDay
          ? checkin.claimedToday
            ? 'claimed'
            : 'today'
          : 'upcoming';
    return { day, coins, state };
  });
}

function minutesOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Whether it is peak hours in India now, and if not, how long until they start.
 *
 * growth-plan-v1 concentrates hosts into one evening slot so rooms are full
 * when people arrive. Outside it, an empty feed says WHEN to come back rather
 * than just "nothing here" — the difference between a user who returns at 8pm
 * and one who uninstalls. Handles a window that crosses midnight.
 */
export function peakWindow(
  config: Pick<ColdStartConfig, 'peakStartIst' | 'peakEndIst'>,
  now: number = Date.now(),
): { live: true } | { live: false; startsInMinutes: number } {
  const ist = new Date(now + 5.5 * 3_600_000);
  const current = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const start = minutesOf(config.peakStartIst);
  const end = minutesOf(config.peakEndIst);

  const inside =
    start <= end ? current >= start && current < end : current >= start || current < end;
  if (inside) return { live: true };

  return { live: false, startsInMinutes: (start - current + 24 * 60) % (24 * 60) };
}
