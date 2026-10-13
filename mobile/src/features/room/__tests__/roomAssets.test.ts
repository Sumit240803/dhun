import { ROOM_ASSETS, pendingRoomAssets, roomAssetPath } from '@/features/room/roomAssets';

describe('the room art order', () => {
  it('returns null for anything not yet drawn, so a component draws its fallback', () => {
    // A path that 404s is a broken image in a live room. Null is the signal to
    // draw the code stand-in instead, and every caller handles it.
    for (const id of pendingRoomAssets()) {
      expect(roomAssetPath(id)).toBeNull();
    }
  });

  it('gives every asset a versioned, immutable path', () => {
    // docs/asset-contract.md §1: a file at a path never changes, new art gets
    // a new version. The client caches forever on that assumption.
    for (const asset of Object.values(ROOM_ASSETS)) {
      expect(asset.path).toMatch(/\.v\d+\.(webp|json)$/);
      expect(asset.path.startsWith('/')).toBe(false);
    }
  });

  it('gives every asset a spec a designer could work from', () => {
    // The registry IS the brief. An entry with no dimensions is an entry
    // somebody will have to come back and ask about.
    for (const asset of Object.values(ROOM_ASSETS)) {
      expect(asset.spec.length).toBeGreaterThan(40);
      expect(asset.spec).toMatch(/\d+\s*[×x]\s*\d+/);
    }
  });

  it('still has art outstanding — and this list is the order', () => {
    // Fails the day everything is drawn, which is the right moment to be told:
    // the fallbacks can come out and this test can go.
    expect(pendingRoomAssets().length).toBeGreaterThan(0);
  });
});
