import { ApiError } from '@/api/client';
import { EMPTY_LOOK, type Cosmetic, type EntryView, type OwnedCosmetic } from '@/api/types';
import { gemsForCoins, itemStatus, previewLook } from '@/features/cosmetics/ownership';
import { IntentKeys } from '@/lib/intentKeys';
import { EntryEffects } from '@/visuals/entryEffects';
import { daysLeft } from '@/visuals/look';

// Style values are opaque strings to everything under test, so they are named
// rather than written as colours.
const NOW = Date.parse('2026-09-16T12:00:00Z');
const DAY = 86_400_000;

function owned(overrides: Partial<OwnedCosmetic> = {}): OwnedCosmetic {
  return {
    cosmeticId: 'frame_basic',
    kind: 'frame',
    name: 'Classic Frame',
    expiresAt: new Date(NOW + 10 * DAY).toISOString(),
    active: true,
    equipped: true,
    ...overrides,
  };
}

describe('what the store says about an item', () => {
  it('is available when never bought', () => {
    expect(itemStatus('frame_basic', [], NOW)).toEqual({ kind: 'available' });
  });

  it('says wearing, or owned, with the days left', () => {
    expect(itemStatus('frame_basic', [owned()], NOW)).toEqual({ kind: 'wearing', daysLeft: 10 });
    expect(itemStatus('frame_basic', [owned({ equipped: false })], NOW)).toEqual({
      kind: 'owned',
      daysLeft: 10,
    });
  });

  it('calls a lapsed item expired, even when the list said active when fetched', () => {
    const stale = owned({ expiresAt: new Date(NOW - 1_000).toISOString(), active: true });
    expect(itemStatus('frame_basic', [stale], NOW)).toEqual({ kind: 'expired' });
  });

  it('rounds the last hours UP to a day, never down to "0 days"', () => {
    expect(daysLeft(new Date(NOW + 6 * 3_600_000).toISOString(), NOW)).toBe(1);
    expect(daysLeft(new Date(NOW - 1).toISOString(), NOW)).toBe(0);
  });
});

describe('previewing', () => {
  const frame: Cosmetic = {
    id: 'frame_rose',
    name: 'Rose Frame',
    kind: 'frame',
    gemPrice: 3_250,
    durationDays: 30,
    freeAtUserLevel: null,
    asset: 'frames/rose.v1.webp',
    style: { light: { ring: 'rose-light' }, dark: { ring: 'rose-dark' } },
  };

  it('puts the item on, and keeps everything else they wear', () => {
    const wearing = {
      ...EMPTY_LOOK,
      nameColor: { light: { color: 'teal-light' }, dark: { color: 'teal-dark' } },
    };
    const preview = previewLook(wearing, frame);

    expect(preview.frame).toEqual({ asset: frame.asset, style: frame.style });
    expect(preview.nameColor).toBe(wearing.nameColor);
  });
});

describe('conversion', () => {
  it('matches the server: floor, in basis points', () => {
    expect(gemsForCoins(6_500, 12_000)).toBe(7_800);
    expect(gemsForCoins(101, 12_000)).toBe(121);
  });
});

describe('idempotency keys for a spend', () => {
  it('reuses a key only to retry an unknown outcome of the same intent', () => {
    let n = 0;
    const keys = new IntentKeys(() => `k${++n}`);

    const first = keys.begin('buy:frame_rose');
    keys.settle('buy:frame_rose', first, new ApiError('NETWORK_ERROR', 'offline', 0));
    expect(keys.begin('buy:frame_rose')).toBe(first);

    const refused = keys.begin('buy:frame_basic');
    keys.settle('buy:frame_basic', refused, new ApiError('INSUFFICIENT_BALANCE', 'no', 402));
    expect(keys.begin('buy:frame_basic')).not.toBe(refused);
  });
});

describe('entry effects', () => {
  function arrival(userId: string): EntryView {
    return {
      userId,
      name: userId,
      avatarUrl: null,
      look: {
        ...EMPTY_LOOK,
        entry: {
          asset: null,
          style: { light: { accent: 'violet-light' }, dark: { accent: 'violet-dark' } },
        },
      },
    };
  }

  it('shows one at a time, in arrival order', () => {
    const effects = new EntryEffects();
    effects.push(arrival('a'));
    effects.push(arrival('b'));

    expect(effects.getCurrent()?.userId).toBe('a');
    effects.finish();
    expect(effects.getCurrent()?.userId).toBe('b');
    effects.finish();
    expect(effects.getCurrent()).toBeNull();
  });

  it('never queues the same person twice', () => {
    const effects = new EntryEffects();
    effects.push(arrival('a'));
    effects.push(arrival('b'));
    effects.push(arrival('b'));
    effects.push(arrival('a'));

    expect(effects.pending).toBe(1);
  });

  it('drops the OLDEST waiting entrance when a burst backs up', () => {
    // An arrival announced a minute late is about someone already sitting down.
    const effects = new EntryEffects();
    for (const id of ['now', 'w1', 'w2', 'w3', 'w4', 'w5']) effects.push(arrival(id));

    const shown: string[] = [];
    while (effects.getCurrent()) {
      shown.push(effects.getCurrent()!.userId);
      effects.finish();
    }
    expect(shown).toEqual(['now', 'w2', 'w3', 'w4', 'w5']);
  });
});
