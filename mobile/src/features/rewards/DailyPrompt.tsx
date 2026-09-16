// The check-in, offered once a day when the app opens.
//
// growth-plan-v1 names the check-in streak as a D2–D7 retention hook, and a
// streak nobody is reminded of is a streak nobody keeps. So the first open of
// each IST day offers it — once. Dismissing it is respected until tomorrow; a
// prompt that reappears on every tab switch is how an app gets uninstalled.

import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useRewards } from '@/api/queries/useGrowth';
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
  const sheet = useRef<SheetHandle>(null);
  const decided = useRef(false);

  const claimable = rewards.data !== undefined && !rewards.data.checkin.claimedToday;

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
