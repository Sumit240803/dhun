import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { spacing } from '@/theme';
import { Screen } from '@/ui/Screen';

/**
 * The safe-area mock reports no insets, which isolates what these are testing:
 * the GUTTER. With real insets the numbers would move and the assertion would
 * be about the mock rather than about the component.
 */
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-keyboard-controller', () => ({
  // require, not import: jest hoists module factories above every import, so
  // an imported binding is not defined yet when this runs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  KeyboardAwareScrollView: require('react-native').ScrollView,
}));

function styleOf(element: { props: { style?: unknown } }) {
  const style = element.props.style;
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(9) : [style]).filter(Boolean));
}

describe('Screen padding', () => {
  it('applies a horizontal gutter when padded', async () => {
    // The bug this guards: the inset object set `paddingLeft: 0` and the gutter
    // set `paddingHorizontal`. React Native resolves the LONGHAND over the
    // shorthand regardless of array order, so every padded screen rendered
    // flush to both edges — for weeks, on every screen using <Screen padded>.
    const screen = await render(
      <Screen testID="screen">
        <Text>hi</Text>
      </Screen>,
    );

    const style = styleOf(screen.getByTestId('screen'));
    expect(style.paddingLeft).toBe(spacing.lg);
    expect(style.paddingRight).toBe(spacing.lg);
  });

  it('applies no gutter when padded is false', async () => {
    const screen = await render(
      <Screen padded={false} testID="screen">
        <Text>hi</Text>
      </Screen>,
    );

    const style = styleOf(screen.getByTestId('screen'));
    expect(style.paddingLeft).toBe(0);
    expect(style.paddingRight).toBe(0);
  });
});
