import { render } from '@testing-library/react-native';

import { EMPTY_LOOK, type FeedRoom } from '@/api/types';
import { RoomCard } from '@/visuals/RoomCard';

const party: FeedRoom = {
  id: 'room-1',
  hostId: 'host',
  hostName: 'Lisha',
  hostLevel: 12,
  hostLook: EMPTY_LOOK,
  title: 'Evening adda',
  tag: 'chatting',
  country: 'IN',
  viewers: 807,
  coverUrl: null,
  seatCount: 10,
  seatCapacity: 12,
  seatFaces: [
    { userId: 'a', avatarUrl: 'https://cdn.example/a.webp' },
    { userId: 'b', avatarUrl: null },
    { userId: 'c', avatarUrl: 'https://cdn.example/c.webp' },
  ],
  video: false,
  trending: false,
};

describe('RoomCard', () => {
  it('stacks the faces of the people seated, then the count', async () => {
    const screen = await render(<RoomCard room={party} tagLabel="Chatting" onPress={() => {}} />);

    for (const id of ['a', 'b', 'c']) expect(screen.getByTestId(`seat-face-${id}`)).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByLabelText('Host level 12')).toBeTruthy();
  });

  it('draws no seat stack for a room without seats', async () => {
    const live = { ...party, seatCount: null, seatCapacity: null, seatFaces: [] };
    const screen = await render(<RoomCard room={live} tagLabel="Chatting" onPress={() => {}} />);

    expect(screen.queryByTestId('seat-face-a')).toBeNull();
    expect(screen.getByText('Lisha')).toBeTruthy();
  });
});
