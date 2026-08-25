import { act, render, renderHook } from '@testing-library/react-native';
import { Text } from 'react-native';

import { setLocale, useTranslation } from '@/i18n';

function Label() {
  const { t } = useTranslation();
  return <Text>{t('common.continue')}</Text>;
}

afterEach(async () => {
  await act(async () => setLocale('en'));
});

describe('switching language', () => {
  it('re-renders in every direction, not just into Hindi', async () => {
    // The bug this guards: switching TO Hindi only appeared to work because a
    // screen happened to remount, and switching BACK looked broken.
    const screen = await render(<Label />);
    expect(screen.getByText('Continue')).toBeOnTheScreen();

    await act(async () => setLocale('hi'));
    expect(screen.getByText('आगे बढ़ें')).toBeOnTheScreen();

    await act(async () => setLocale('en'));
    expect(screen.getByText('Continue')).toBeOnTheScreen();
  });

  it('gives `t` a new identity per locale', async () => {
    // The invariant that makes the above hold under React Compiler: a call with
    // a stable callee and a literal key gets memoised, so the callee has to
    // change when the locale does or the cached string is never recomputed.
    const hook = await renderHook(() => useTranslation());
    const before = hook.result.current.t;

    await act(async () => setLocale('hi'));

    expect(hook.result.current.t).not.toBe(before);
  });

  it('reports the current locale, so a selected chip is correct', async () => {
    const hook = await renderHook(() => useTranslation());
    expect(hook.result.current.locale).toBe('en');

    await act(async () => setLocale('hi'));

    expect(hook.result.current.locale).toBe('hi');
  });
});
