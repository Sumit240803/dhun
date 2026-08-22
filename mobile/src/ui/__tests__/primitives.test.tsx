import { fireEvent, render } from '@testing-library/react-native';

// Imported per-file rather than through '@/ui': the barrel pulls in Screen and
// Sheet, which drag native modules a logic test has no reason to load.
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { ListItem } from '@/ui/ListItem';

// react-native-testing-library 14 made `render` asynchronous — it awaits React
// 19's concurrent commit. Forgetting the await returns a Promise whose query
// methods are all undefined, which fails with a confusing message.

describe('Button', () => {
  it('fires onPress when enabled', async () => {
    const onPress = jest.fn();
    const screen = await render(<Button label="Continue" onPress={onPress} testID="btn" />);

    fireEvent.press(screen.getByTestId('btn'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire while loading', async () => {
    // The case this guards: a double-tapped "Send code" is two OTPs and a
    // rate-limit block the user did not earn.
    const onPress = jest.fn();
    const screen = await render(
      <Button label="Send code" onPress={onPress} loading testID="btn" />,
    );

    fireEvent.press(screen.getByTestId('btn'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', async () => {
    const onPress = jest.fn();
    const screen = await render(
      <Button label="Continue" onPress={onPress} disabled testID="btn" />,
    );

    fireEvent.press(screen.getByTestId('btn'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('reports busy state to assistive tech', async () => {
    const screen = await render(
      <Button label="Send code" onPress={jest.fn()} loading testID="btn" />,
    );

    const button = screen.getByTestId('btn');
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
  });
});

describe('Input', () => {
  it('announces the error, since React Native has no invalid state', async () => {
    const screen = await render(
      <Input label="Phone number" error="Enter a valid 10-digit number" />,
    );

    expect(screen.getByLabelText('Phone number Enter a valid 10-digit number')).toBeOnTheScreen();
  });

  it('shows helper text only while there is no error', async () => {
    const screen = await render(<Input label="Phone number" helper="We will send a code" />);
    expect(screen.getByText('We will send a code')).toBeOnTheScreen();

    await screen.rerender(
      <Input label="Phone number" helper="We will send a code" error="Too short" />,
    );

    expect(screen.queryByText('We will send a code')).toBeNull();
    expect(screen.getByText('Too short')).toBeOnTheScreen();
  });
});

describe('ListItem', () => {
  it('reads title and subtitle as one label', async () => {
    const screen = await render(
      <ListItem title="Coins" subtitle="1,64,945" onPress={jest.fn()} testID="row" />,
    );

    expect(screen.getByTestId('row')).toHaveProp('accessibilityLabel', 'Coins. 1,64,945');
  });
});
