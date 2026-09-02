import { useState, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';

import { moderationApi } from '@/api/endpoints/feed';
import { REPORT_REASONS, type ReportReason } from '@/api/types';
import { useTranslation, type MessageKey } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { Banner, Button, Column, Input, ListItem, Sheet, Text, type SheetHandle } from '@/ui';

const REASON_LABELS: Record<ReportReason, MessageKey> = {
  nudity: 'report.reasonNudity',
  harassment: 'report.reasonHarassment',
  hate: 'report.reasonHate',
  violence: 'report.reasonViolence',
  self_harm: 'report.reasonSelfHarm',
  minor: 'report.reasonMinor',
  scam: 'report.reasonScam',
  spam: 'report.reasonSpam',
  impersonation: 'report.reasonImpersonation',
  illegal: 'report.reasonIllegal',
  other: 'report.reasonOther',
};

export interface ReportSheetProps {
  subjectType: 'user' | 'room' | 'message';
  subjectId: string;
  ref?: Ref<SheetHandle>;
}

/**
 * The report flow.
 *
 * Reasons are a CLOSED set matching the server's, in the order a distressed
 * person scans them: the ones that need acting on within minutes first. Free
 * text is optional and secondary — it cannot be counted, triaged, or turned
 * into a threshold that pages someone.
 *
 * Always confirms success, even when the server says the report was a
 * same-day duplicate. The user did the right thing; telling them their report
 * "didn't count" teaches them not to bother next time.
 */
export function ReportSheet({ subjectType, subjectId, ref }: ReportSheetProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    if (reason === null || sending) return;
    setSending(true);
    setError(null);

    try {
      await moderationApi.report({
        subjectType,
        subjectId,
        reason,
        detail: detail.trim() || undefined,
      });
      haptic.success();
      setSent(true);
    } catch (caught) {
      haptic.error();
      setError(caught);
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet ref={ref} title={t('report.title')} snapPoints={['80%']}>
      {sent ? (
        <Column gap="lg">
          <Banner tone="info" message={t('report.sent')} />
          <Button
            label={t('common.done')}
            onPress={() => {
              setSent(false);
              setReason(null);
              setDetail('');
            }}
            fullWidth
          />
        </Column>
      ) : (
        <Column gap="md">
          <Text variant="caption" tone="secondary">
            {t('report.body')}
          </Text>

          <View style={styles.reasons}>
            {REPORT_REASONS.map((value) => (
              <ListItem
                key={value}
                title={t(REASON_LABELS[value])}
                onPress={() => {
                  haptic.selection();
                  setReason(value);
                }}
                right={
                  reason === value ? (
                    <Text variant="bodyStrong" tone="brand">
                      ✓
                    </Text>
                  ) : undefined
                }
                testID={`reason-${value}`}
              />
            ))}
          </View>

          <Input
            placeholder={t('report.detailPlaceholder')}
            value={detail}
            onChangeText={setDetail}
            maxLength={500}
            multiline
          />

          {error !== null && <Banner message={errorMessage(error)} />}

          <Button
            label={t('report.submit')}
            onPress={submit}
            disabled={reason === null}
            loading={sending}
            variant="danger"
            fullWidth
            testID="submit-report"
          />
        </Column>
      )}
    </Sheet>
  );
}

export type { SheetHandle };

const styles = StyleSheet.create({
  reasons: { maxHeight: 320 },
});
