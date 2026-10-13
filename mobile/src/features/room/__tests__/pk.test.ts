import {
  formatPkClock,
  pkBoundary,
  pkLeader,
  pkSecondsLeft,
  type PkState,
} from '@/features/room/pk/types';
import { MarqueeQueue } from '@/features/room/chrome/marqueeQueue';

function battle(left: number, right: number, over: Partial<PkState> = {}): PkState {
  const side = (userId: string, score: number) => ({
    userId,
    roomId: `room-${userId}`,
    displayName: userId,
    avatarUrl: null,
    score,
    streak: 0,
    winMultiplier: 1,
    supporters: [],
    team: [],
  });

  return {
    id: 'pk-1',
    mode: '1v1',
    phase: 'live',
    home: 0,
    endsAt: new Date(Date.now() + 60_000).toISOString(),
    winner: null,
    sides: [side('left', left), side('right', right)],
    ...over,
  };
}

describe('pkBoundary', () => {
  it('sits dead centre before anybody has scored', () => {
    expect(pkBoundary(battle(0, 0))).toBe(0.5);
  });

  it('is the score RATIO, not an absolute scale', () => {
    // A battle at 200 vs 600 and one at 2,000,000 vs 6,000,000 must look
    // identical: what the bar shows is who is winning, not how much.
    expect(pkBoundary(battle(200, 600))).toBeCloseTo(pkBoundary(battle(2_000_000, 6_000_000)));
  });

  it('never erases the losing side', () => {
    // THE reason this is a function. A 0-vs-50,000 battle would otherwise pin
    // the bar to the edge and hide the number its audience is being asked to
    // change — which is the whole mechanic.
    expect(pkBoundary(battle(0, 50_000))).toBeGreaterThanOrEqual(0.12);
    expect(pkBoundary(battle(50_000, 0))).toBeLessThanOrEqual(0.88);
  });
});

describe('pkLeader', () => {
  it('names nobody while the scores are level', () => {
    expect(pkLeader(battle(400, 400))).toBeNull();
  });

  it('names the side that is ahead', () => {
    expect(pkLeader(battle(401, 400))).toBe(0);
    expect(pkLeader(battle(400, 401))).toBe(1);
  });
});

describe('the clock', () => {
  it('never goes negative once the whistle has gone', () => {
    const over = battle(1, 1, { endsAt: new Date(Date.now() - 30_000).toISOString() });
    expect(pkSecondsLeft(over)).toBe(0);
  });

  it('formats as the references show it', () => {
    expect(formatPkClock(144)).toBe('02:24');
    expect(formatPkClock(9)).toBe('00:09');
    expect(formatPkClock(-5)).toBe('00:00');
  });
});

describe('MarqueeQueue', () => {
  it('shows the first announcement immediately', () => {
    const queue = new MarqueeQueue(1_000);
    queue.push({ id: 'a', kind: 'gift', text: 'first' });
    expect(queue.getSnapshot()?.text).toBe('first');
    queue.clear();
  });

  it('ignores a redelivered announcement', () => {
    // The gateway can redeliver on reconnect, and the id is the ledger
    // transaction id — so the same gift must never scroll twice.
    const queue = new MarqueeQueue(1_000);
    const seen: (string | undefined)[] = [];
    queue.subscribe(() => seen.push(queue.getSnapshot()?.id));

    queue.push({ id: 'a', kind: 'gift', text: 'first' });
    queue.push({ id: 'a', kind: 'gift', text: 'first again' });

    expect(seen.filter((id) => id === 'a')).toHaveLength(1);
    queue.clear();
  });

  it('sheds the cheapest when a storm backs it up, never the Galaxy', () => {
    const queue = new MarqueeQueue(60_000);
    queue.push({ id: 'current', kind: 'gift', text: 'on screen', weight: 1 });

    // Fill past the cap with cheap announcements, then add an expensive one.
    for (let i = 0; i < 20; i += 1) {
      queue.push({ id: `cheap-${i}`, kind: 'gift', text: 'rose', weight: 20 });
    }
    queue.push({ id: 'galaxy', kind: 'global', text: 'Galaxy', weight: 1_650_000 });

    // Drain the queue and confirm the Galaxy survived the cull. Dropping a
    // ₹15,000 gift behind two hundred Roses is a refund request.
    const shown: string[] = [];
    const queued = queue as unknown as { queue: { id: string }[] };
    for (const item of queued.queue) shown.push(item.id);

    expect(shown).toContain('galaxy');
    queue.clear();
  });
});
