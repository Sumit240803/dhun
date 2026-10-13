import { buildStage, seatGridLayout, MAX_VIDEO_TILES } from '@/features/room/model';
import { EMPTY_LOOK } from '@/api/types';
import type { SeatView } from '@/features/room/gateway';
import type { PkState } from '@/features/room/pk/types';

const HOST = 'host-1';

function room(over: Partial<Parameters<typeof buildStage>[0]['room']> = {}) {
  return {
    hostId: HOST,
    hostName: 'Meera',
    seatCapacity: null as number | null,
    video: false,
    ...over,
  };
}

function seat(seatIndex: number, userId: string): SeatView {
  return {
    seatIndex,
    userId,
    displayName: userId,
    muted: false,
    look: EMPTY_LOOK,
  };
}

describe('buildStage', () => {
  it('gives a lone audio host the solo stage', () => {
    const stage = buildStage({ room: room(), seats: [] });
    expect(stage.kind).toBe('solo');
  });

  it('treats the host as present even when they hold no seat', () => {
    // The gap this guards: a single-host broadcast has no seat row for its
    // host, and deriving "the host" from the seat table alone once left them
    // muted in their own room with no control to undo it.
    const stage = buildStage({ room: room(), seats: [] });
    expect(stage.kind === 'solo' && stage.host?.userId).toBe(HOST);
    expect(stage.kind === 'solo' && stage.host?.seatIndex).toBe(-1);
  });

  it('fills a party room with empty slots up to its capacity', () => {
    const stage = buildStage({
      room: room({ seatCapacity: 9 }),
      seats: [seat(0, HOST), seat(4, 'u-4')],
    });

    expect(stage.kind).toBe('seats');
    if (stage.kind !== 'seats') return;
    expect(stage.slots).toHaveLength(9);
    expect(stage.slots.filter((s) => s.kind === 'taken')).toHaveLength(2);
    // Order matters: the numbers under the seats are what people quote in
    // chat, so slot N must be seat N whoever is sitting where.
    expect(stage.slots[4]!.seatIndex).toBe(4);
    expect(stage.slots[4]!.kind).toBe('taken');
    expect(stage.slots[1]!.kind).toBe('empty');
  });

  it('marks the host among the seats', () => {
    const stage = buildStage({ room: room({ seatCapacity: 4 }), seats: [seat(0, HOST)] });
    if (stage.kind !== 'seats') throw new Error('expected seats');
    const first = stage.slots[0]!;
    expect(first.kind === 'taken' && first.isHost).toBe(true);
  });

  it('puts the host on the first video tile and the rest on the rail', () => {
    const stage = buildStage({
      room: room({ video: true, seatCapacity: 6 }),
      seats: [seat(0, HOST), seat(1, 'guest-a'), seat(2, 'guest-b'), seat(3, 'guest-c')],
    });

    expect(stage.kind).toBe('video');
    if (stage.kind !== 'video') return;
    expect(stage.tiles).toHaveLength(MAX_VIDEO_TILES);
    expect(stage.tiles[0]!.userId).toBe(HOST);
    expect(stage.tiles[1]!.userId).toBe('guest-a');
    // This is the layout the references use most: one or two on camera, the
    // rest talking from a column on the right.
    expect(stage.micRail.map((o) => o.userId)).toEqual(['guest-b', 'guest-c']);
  });

  it('falls back to seats when video rooms are switched off', () => {
    // `videoRoomsEnabled` is a kill switch. Off, a video room must still be
    // joinable as a voice room rather than rendering an empty stage.
    const stage = buildStage({
      room: room({ video: true, seatCapacity: 6 }),
      seats: [seat(0, HOST)],
      videoEnabled: false,
    });
    expect(stage.kind).toBe('seats');
  });

  it('shows the battle whatever the room is underneath', () => {
    const pk = { id: 'pk-1', mode: '1v1' } as PkState;
    const stage = buildStage({ room: room({ seatCapacity: 9 }), seats: [seat(0, HOST)], pk });
    expect(stage.kind).toBe('pk');
  });
});

describe('seatGridLayout', () => {
  it('steps the grid rather than scaling it smoothly', () => {
    // A smooth scale would make a 12-seat room look like a shrunken 9-seat
    // one. The references step it, and so does this.
    expect(seatGridLayout(4).columns).toBe(2);
    expect(seatGridLayout(9).columns).toBe(3);
    expect(seatGridLayout(12).columns).toBe(4);
    expect(seatGridLayout(20).columns).toBe(5);
  });

  it('shrinks the avatar as the grid widens', () => {
    expect(seatGridLayout(4).avatar).toBeGreaterThan(seatGridLayout(9).avatar);
    expect(seatGridLayout(9).avatar).toBeGreaterThan(seatGridLayout(20).avatar);
  });

  it('drops the name label once it would be two characters wide', () => {
    expect(seatGridLayout(16).showMeta).toBe(true);
    expect(seatGridLayout(20).showMeta).toBe(false);
  });
});
