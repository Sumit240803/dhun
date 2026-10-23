// The check-in, offered once a day when the app opens.
//
// growth-plan-v1 names the check-in streak as a D2–D7 retention hook, and a
// streak nobody is reminded of is a streak nobody keeps. So the first open of
// each IST day offers it — once. Dismissing it is respected until tomorrow; a
// prompt that reappears on every tab switch is how an app gets uninstalled.

import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useNewUserRewards, useRewards } from '@/api/queries/useGrowth';
import { useFlag } from '@/config/flags';
import { useTranslation } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { istDate, preferences } from '@/lib/preferences';
import { useIsRegistered } from '@/store/session';
import { Button, Sheet, type SheetHandle } from '@/ui';
import { CheckinCard } from './CheckinCard';

const SHOWN_ON = 'rewards.promptShownOn';

export function DailyPrompt() {
  const { t } = useTranslation();
  const isRegistered = useIsRegistered();
  const rewards = useRewards(isRegistered);
  // During the first week the new-user sheet carries the check-in as its
  // first row, so this prompt stands aside: two sheets on one open is one too many.
  const newUser = useNewUserRewards(isRegistered);
  const rewardsEnabled = useFlag('rewardsEnabled');
  const sheet = useRef<SheetHandle>(null);
  const decided = useRef(false);

  const claimable =
    rewardsEnabled &&
    rewards.data !== undefined &&
    !rewards.data.checkin.claimedToday &&
    // Settled, and no sheet. An error counts as no sheet — a failed fetch of
    // the new-user state must not cost the user their daily prompt.
    !newUser.isPending &&
    !newUser.data;

  useEffect(() => {
    if (!claimable || decided.current) return;
    decided.current = true;

    void (async () => {
      const today = istDate();
      if ((await preferences.get(SHOWN_ON)) === today) return;
      await preferences.set(SHOWN_ON, today);
      sheet.current?.present();
    })();
  }, [claimable]);

  if (!rewards.data) return null;

  return (
    <Sheet ref={sheet} title={t('rewards.promptTitle')}>
      <CheckinCard
        checkin={rewards.data.checkin}
        // A beat to see the tick land before the sheet goes.
        onClaimed={() => setTimeout(() => sheet.current?.dismiss(), 900)}
      />
      <Button
        label={t('rewards.seeAll')}
        onPress={() => {
          haptic.selection();
          sheet.current?.dismiss();
          router.push('/(app)/rewards');
        }}
        variant="ghost"
        fullWidth
      />
    </Sheet>
  );
}
