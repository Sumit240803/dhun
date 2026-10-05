import { useState, type Ref } from 'react';
import { StyleSheet } from 'react-native';

import { useQuitAgency } from '@/api/queries/useAgency';
import { useTranslation, type MessageKey } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { Banner, Button, Column, Input, Row, Sheet, Text, type SheetHandle } from '@/ui';

import { cooldownUntil, formatDay } from './format';

const RULES: MessageKey[] = [
  'agency.quitRule1',
  'agency.quitRule2',
  'agency.quitRule3',
  'agency.quitRule4',
  'agency.quitRule5',
];

/**
 * Applying to leave.
 *
 * The rules come first and in full, because two of them decide whether the
 * host leaves at once or waits a week, and one of them stops a second
 * application for a month — none of which should be a surprise after tapping.
 */
export function QuitSheet({ ref, onLeft }: { ref: Ref<SheetHandle>; onLeft: () => void }) {
  const { t, locale } = useTranslation();
  const quit = useQuitAgency();
  const [reason, setReason] = useState('');

  const until = cooldownUntil(quit.error);
  const error =
    until !== undefined
      ? t('agency.quitCooldownUntil', { date: formatDay(until, locale) })
      : quit.error != null
        ? errorMessage(quit.error)
        : undefined;

  function submit() {
    haptic.tap();
    quit.mutate(reason.trim(), {
      onSuccess: (result) => {
        haptic.success();
        setReason('');
        if (result.outcome === 'left') onLeft();
        if (typeof ref === 'object' && ref?.current) ref.current.dismiss();
      },
      onError: () => haptic.error(),
    });
  }

  return (
    <Sheet ref={ref} title={t('agency.quitTitle')} onDismiss={() => quit.reset()}>
      <Column gap="sm">
        {RULES.map((key, i) => (
          <Row key={key} gap="sm" align="start">
            <Text variant="caption" tone="faint">
              {i + 1}.
            </Text>
            <Text variant="caption" tone="secondary" style={styles.rule}>
              {t(key)}
            </Text>
          </Row>
        ))}
      </Column>

      <Input
        label={t('agency.reasonLabel')}
        helper={t('agency.reasonHelper')}
        value={reason}
        onChangeText={setReason}
        maxLength={100}
        multiline
        testID="quit-reason"
      />
      <Text variant="micro" tone="faint">
        {reason.length}/100
      </Text>

      {error !== undefined && <Banner message={error} />}

      <Button
        label={t('agency.submitQuit')}
        onPress={submit}
        disabled={reason.trim().length === 0}
        loading={quit.isPending}
        variant="danger"
        fullWidth
        testID="submit-quit"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({ rule: { flex: 1 } });
