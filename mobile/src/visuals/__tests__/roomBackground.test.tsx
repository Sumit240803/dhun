import { render } from '@testing-library/react-native';

// `render` is ASYNCHRONOUS in react-native-testing-library 14 — it awaits
// React 19's concurrent commit. Forgetting the await returns a Promise whose
// query methods are all undefined.

import { RoomBackground } from '@/visuals/RoomBackground';

jest.mock('expo-image', () => ({
  // A real <Image> would try to decode a URI in a test renderer. What matters
  // here is WHETHER one is drawn and with what uri, not what it looks like.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Image: require('react-native').View,
}));

jest.mock('expo-linear-gradient', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  LinearGradient: require('react-native').View,
}));

describe('RoomBackground', () => {
  it('resolves a catalog path against the asset base', async () => {
    const { getByTestId } = await render(
      <RoomBackground path="rooms/backgrounds/coast-road.v1.webp" />,
    );

    const image = getByTestId('room-backdrop-image');
    const { uri } = (image.props as { source: { uri: string } }).source;
    // A PATH, resolved here. The server deliberately does not send a URL, so a
    // component that handed the raw value to <Image> would ask for
    // `rooms/backgrounds/...` relative to nothing and silently show nothing.
    expect(uri).toMatch(/^https?:\/\/.+\/rooms\/backgrounds\/coast-road\.v1\.webp$/);
  });

  it('draws no image when the room has no backdrop', async () => {
    // Null is an ordinary case: a room created before backdrops existed, or one
    // whose backdrop has since been retired from config. It must render the
    // plain dark base rather than an <Image> pointed at the asset base itself.
    const { queryByTestId, getByTestId } = await render(<RoomBackground path={null} />);
    expect(queryByTestId('room-backdrop-image')).toBeNull();
    expect(getByTestId('room-backdrop')).toBeTruthy();
  });

  it('never intercepts touches', async () => {
    // It covers the whole room. A backdrop that swallowed a tap would break
    // taking a seat, sending a gift and leaving, and nobody would look here.
    const { getByTestId } = await render(
      <RoomBackground path="rooms/backgrounds/ice-stage.v1.webp" />,
    );
    expect(getByTestId('room-backdrop').props.pointerEvents).toBe('none');
  });
});
