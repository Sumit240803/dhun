// What kind of room this is, and therefore what the stage draws.
//
// ── Why this is a pure function and not a pile of ternaries in the screen ────
//
// The reference apps run six visibly different rooms — a voice party, a video
// broadcast, a video broadcast with guests on the side, a 1v1 PK battle, a team
// PK, and a big 20-seat hall — and they are all ONE screen with one set of
// chrome. Only the middle changes.
//
// So the middle is a tagged union computed once from the room's own data, and
// `<Stage>` switches on the tag. The alternative, which this replaces, is
// `room.seatCapacity != null ? … : …` repeated in a dozen places until nobody
// can say with confidence what a solo video host with two guests actually
// renders.
//
// It is pure so it can be tested without a renderer, a socket or a media
// server. Every layout decision in the room is one function call away from an
// assertion.

import type { LiveRoom } from '@/api/types';

import type { PkState } from './pk/types';
import type { SeatView } from './gateway';

/** A participant drawn on the stage, whatever shape that stage is. */
export interface StageOccupant {
  /** The seat they hold, or -1 for a host who has no seat (a solo broadcast). */
  seatIndex: number;
  userId: string;
  displayName: string | null;
  /** Silenced BY THE HOST. Not the same as having your own mic off. */
  muted: boolean;
  look: SeatView['look'] | null;
  isHost: boolean;
}

/** An empty place somebody can ask for. */
export interface StageVacancy {
  seatIndex: number;
}

export type StageSlot = ({ kind: 'taken' } & StageOccupant) | ({ kind: 'empty' } & StageVacancy);

export type StageModel =
  /**
   * Two hosts, one bar, one timer. The money screen: each side's audience pays
   * to push the boundary, which is why it gets its own stage rather than being
   * a decoration on the video one.
   */
  | { kind: 'pk'; pk: PkState; micRail: StageOccupant[] }
  /**
   * One or two video tiles, with anyone else on mic listed down the right edge.
   *
   * The rail is the layout the references use for "one person on camera, four
   * more talking" — and it is why `video` does not simply mean "no seats". A
   * video room can have seats; they just do not get tiles.
   */
  | { kind: 'video'; tiles: StageOccupant[]; micRail: StageOccupant[] }
  /** A party room: a grid of seats, every one of them tappable. */
  | { kind: 'seats'; slots: StageSlot[]; capacity: number; host: StageOccupant | null }
  /** A host alone, on audio. The smallest room there is. */
  | { kind: 'solo'; host: StageOccupant | null };

export type StageKind = StageModel['kind'];

interface Input {
  room: Pick<LiveRoom, 'hostId' | 'hostName' | 'seatCapacity' | 'video'> | null | undefined;
  seats: SeatView[];
  /** Null until PK exists on the backend; the stage is built and waiting. */
  pk?: PkState | null;
  /** Feature flag. Off, a video room falls back to its seats or to solo audio. */
  videoEnabled?: boolean;
}

/**
 * How many video tiles a stage will show at most.
 *
 * Two, because that is what fits on a phone at a size where a face is still a
 * face. A third guest goes to the mic rail, which is exactly what the reference
 * apps do rather than shrinking everyone to a thumbnail.
 */
export const MAX_VIDEO_TILES = 2;

export function buildStage({ room, seats, pk = null, videoEnabled = true }: Input): StageModel {
  const host = hostOccupant(room, seats);
  const ordered = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);

  // PK outranks everything. A room in a battle shows the battle, whatever its
  // seat configuration is underneath — the bar and the timer are the reason
  // anybody is looking at it.
  if (pk !== null) {
    return {
      kind: 'pk',
      pk,
      micRail: ordered.filter((s) => s.userId !== room?.hostId).map(toOccupant),
    };
  }

  if (room?.video === true && videoEnabled) {
    // The host always holds the first tile. Everyone else is a guest, and only
    // the first of them gets the second tile; the rest go to the rail.
    const guests = ordered.filter((seat) => seat.userId !== room.hostId).map(toOccupant);
    const tiles =
      host === null
        ? guests.slice(0, MAX_VIDEO_TILES)
        : [host, ...guests].slice(0, MAX_VIDEO_TILES);
    return { kind: 'video', tiles, micRail: guests.slice(Math.max(0, MAX_VIDEO_TILES - 1)) };
  }

  if (room?.seatCapacity != null) {
    const taken = new Map(ordered.map((seat) => [seat.seatIndex, seat]));
    const slots: StageSlot[] = Array.from({ length: room.seatCapacity }, (_, seatIndex) => {
      const seat = taken.get(seatIndex);
      return seat
        ? { kind: 'taken' as const, ...toOccupant(seat), isHost: seat.userId === room.hostId }
        : { kind: 'empty' as const, seatIndex };
    });
    return { kind: 'seats', slots, capacity: room.seatCapacity, host };
  }

  return { kind: 'solo', host };
}

/**
 * The host as an occupant, whether or not they hold a seat.
 *
 * A single-host broadcast has NO seat row for its host — the same gap that once
 * muted hosts in their own rooms. Treating "the host" as derived from the room
 * rather than from the seat table is what closes it here.
 */
function hostOccupant(input: Input['room'], seats: SeatView[]): StageOccupant | null {
  if (!input) return null;
  const seated = seats.find((seat) => seat.userId === input.hostId);
  if (seated) return { ...toOccupant(seated), isHost: true };
  return {
    seatIndex: -1,
    userId: input.hostId,
    displayName: input.hostName,
    muted: false,
    look: null,
    isHost: true,
  };
}

function toOccupant(seat: SeatView): StageOccupant {
  return {
    seatIndex: seat.seatIndex,
    userId: seat.userId,
    displayName: seat.displayName,
    muted: seat.muted,
    look: seat.look,
    isHost: false,
  };
}

// ---------------------------------------------------------------------------
// Seat grid geometry
// ---------------------------------------------------------------------------

export interface SeatGridLayout {
  columns: number;
  /** Diameter of the avatar, in points. */
  avatar: number;
  /** Gap between seats, both axes. */
  gap: number;
  /** Whether a seat shows its number and gift counter. */
  showMeta: boolean;
}

/**
 * How a seat grid is laid out at a given capacity.
 *
 * Taken straight off the references, which step the grid rather than scaling it
 * smoothly: 9 seats is three columns of comfortable avatars, 20 is five columns
 * of thumbnails. A smooth scale would make a 12-seat room look like a shrunken
 * 9-seat one instead of its own thing.
 *
 * The numbers below are the point at which a face stops being recognisable on a
 * 360pt-wide phone, which is the only constraint that actually matters.
 */
export function seatGridLayout(capacity: number): SeatGridLayout {
  if (capacity <= 4) return { columns: 2, avatar: 72, gap: 20, showMeta: true };
  if (capacity <= 9) return { columns: 3, avatar: 58, gap: 14, showMeta: true };
  if (capacity <= 16) return { columns: 4, avatar: 46, gap: 10, showMeta: true };
  // Beyond sixteen the label under a seat is two or three characters wide and
  // stops being a name. The counter stays — it is a number and still reads.
  return { columns: 5, avatar: 38, gap: 8, showMeta: false };
}

/** The gift total a seat displays, from the room leaderboard. */
export type SeatTotals = ReadonlyMap<string, number>;
