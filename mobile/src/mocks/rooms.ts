// Live and party rooms for the feed.
//
// TODO(api): GET /v1/rooms/feed?category= — M5. Match this shape when building it.

/**
 * What a room is FOR. Shown as the badge on each card, and the thing a user
 * actually browses by — nobody opens a live app looking for "content", they
 * are looking for singing, or for someone to talk to.
 */
export type RoomCategory =
  'following' | 'explore' | 'party' | 'singing' | 'dancing' | 'chatting' | 'gaming';

export const ROOM_CATEGORIES: RoomCategory[] = ['following', 'explore', 'party'];

export interface MockRoom {
  id: string;
  /** Host's display name. */
  hostName: string;
  /** The badge in the card's top corner. */
  tag: 'singing' | 'dancing' | 'chatting' | 'gaming' | 'friends' | 'esports';
  /** ISO 3166-1 alpha-2. Rendered as a flag beside the name. */
  country: string;
  viewers: number;
  /** Cover art. Null until there are photographs with rights — see the README. */
  coverUrl: string | null;
  /**
   * Party rooms only: who is on a seat right now, and how many seats are taken.
   * Empty for a single-host live room, which is what distinguishes the two in
   * the UI without needing a second card component.
   */
  seatCount: number | null;
  /** Whether the host is on camera. Audio-only rooms show a different treatment. */
  video: boolean;
  /** Ranked into the hourly top ten. Drives the flame badge. */
  trending: boolean;
}

const EXPLORE: MockRoom[] = [
  {
    id: 'r_001',
    hostName: 'Music broadcast',
    tag: 'singing',
    country: 'IN',
    viewers: 4_700,
    coverUrl: null,
    seatCount: null,
    video: true,
    trending: false,
  },
  {
    id: 'r_002',
    hostName: 'PS5 LIVE GAMEPLAY',
    tag: 'esports',
    country: 'IN',
    viewers: 20_600,
    coverUrl: null,
    seatCount: null,
    video: true,
    trending: true,
  },
  {
    id: 'r_003',
    hostName: 'Gaming Live',
    tag: 'esports',
    country: 'IN',
    viewers: 17_300,
    coverUrl: null,
    seatCount: null,
    video: true,
    trending: false,
  },
  {
    id: 'r_004',
    hostName: 'Shruti',
    tag: 'chatting',
    country: 'IN',
    viewers: 9_100,
    coverUrl: null,
    seatCount: null,
    video: true,
    trending: true,
  },
  {
    id: 'r_005',
    hostName: 'Meera',
    tag: 'friends',
    country: 'IN',
    viewers: 2_400,
    coverUrl: null,
    seatCount: null,
    video: true,
    trending: false,
  },
  {
    id: 'r_006',
    hostName: 'Late night adda',
    tag: 'chatting',
    country: 'IN',
    viewers: 860,
    coverUrl: null,
    seatCount: null,
    video: false,
    trending: false,
  },
  {
    id: 'r_007',
    hostName: 'Ankit',
    tag: 'gaming',
    country: 'IN',
    viewers: 3_300,
    coverUrl: null,
    seatCount: null,
    video: true,
    trending: false,
  },
  {
    id: 'r_008',
    hostName: 'Riya sings',
    tag: 'singing',
    country: 'IN',
    viewers: 12_000,
    coverUrl: null,
    seatCount: null,
    video: true,
    trending: false,
  },
];

const PARTY: MockRoom[] = [
  {
    id: 'p_001',
    hostName: 'LISHA',
    tag: 'dancing',
    country: 'IN',
    viewers: 807,
    coverUrl: null,
    seatCount: 10,
    video: true,
    trending: false,
  },
  {
    id: 'p_002',
    hostName: 'gemig brod',
    tag: 'singing',
    country: 'IN',
    viewers: 2_300,
    coverUrl: null,
    seatCount: 16,
    video: true,
    trending: true,
  },
  {
    id: 'p_003',
    hostName: 'Barbie',
    tag: 'chatting',
    country: 'IN',
    viewers: 443,
    coverUrl: null,
    seatCount: 7,
    video: false,
    trending: false,
  },
  {
    id: 'p_004',
    hostName: 'sabita_nzy',
    tag: 'friends',
    country: 'IN',
    viewers: 629,
    coverUrl: null,
    seatCount: 6,
    video: true,
    trending: false,
  },
  {
    id: 'p_005',
    hostName: 'Dilli se',
    tag: 'chatting',
    country: 'IN',
    viewers: 1_150,
    coverUrl: null,
    seatCount: 9,
    video: false,
    trending: false,
  },
  {
    id: 'p_006',
    hostName: 'Antakshari night',
    tag: 'singing',
    country: 'IN',
    viewers: 2_050,
    coverUrl: null,
    seatCount: 12,
    video: false,
    trending: true,
  },
];

/**
 * Following is deliberately EMPTY.
 *
 * A new user follows nobody, and that is the state most likely to be shipped
 * broken — a blank screen with no way forward. Mocking it empty is what forces
 * the empty state to be designed.
 */
const FOLLOWING: MockRoom[] = [];

export function mockRooms(category: RoomCategory): MockRoom[] {
  switch (category) {
    case 'following':
      return FOLLOWING;
    case 'party':
      return PARTY;
    default:
      return EXPLORE;
  }
}
