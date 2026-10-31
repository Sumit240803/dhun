import { randomUUID } from 'expo-crypto';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';

import { ApiError } from '@/api/client';
import { useSendSuperMessage, useSuperMessageTerms } from '@/api/queries/useCosmetics';
import { useWallet } from '@/api/queries/useWallet';
import { ApiErrorCode } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { IntentKeys } from '@/lib/intentKeys';
import { formatGems } from '@/lib/money';
import { gems } from '@/lib/units';
import { Banner, Button, Column, Input, Row, Sheet, Skeleton, Text, type SheetHandle } from '@/ui';

interface Props {
  roomId: string;
  onTopUp: () => void;
}

/**
 * A super message: gems for a sentence everyone sees, pinned for a while.
 *
 * The price is said before the text box, and the balance after it. Pays the
 * host nothing — the sheet says so, because people assume otherwise.
 */
export const SuperMessageSheet = forwardRef<SheetHandle, Props>(function SuperMessageSheet(
  { roomId, onTopUp },
  ref,
) {
  const { t } = useTranslation();
  const sheet = useRef<SheetHandle>(null);
  const terms = useSuperMessageTerms();
  const wallet = useWallet();
  const send = useSendSuperMessage();
  const [keys] = useState(() => new IntentKeys(randomUUID));
  const [body, setBody] = useState('');
  const [failure, setFailure] = useState<unknown>(null);

  useImperativeHandle(ref, () => ({
    present: () => {
      setFailure(null);
      sheet.current?.present();
    },
    dismiss: () => sheet.current?.dismiss(),
  }));

  const price = terms.data?.gemPrice ?? null;
  const balance = wallet.data?.gems ?? null;
  const short = price !== null && balance !== null && balance < price;
  const ready = body.trim() !== '' && price !== null && !short && !send.isPending;

  async function submit() {
    if (price === null || body.trim() === '') return;
    const text = body.trim();
    const signature = `super:${roomId}:${price}:${text}`;
    const key = keys.begin(signature);
    haptic.tap();
    setFailure(null);
    try {
      await send.mutateAsync({ roomId, body: text, expectedGemPrice: price, idempotencyKey: key });
      keys.settle(signature, key, null);
      haptic.success();
      setBody('');
      sheet.current?.dismiss();
    } catch (error) {
      keys.settle(signature, key, error);
      haptic.error();
      setFailure(error);
    }
  }

  return (
    <Sheet ref={sheet} title={t('room.superTitle')}>
      <Column gap="md">
        <Text variant="caption" tone="secondary">
          {t('room.superBody', { seconds: terms.data?.pinSeconds ?? 30 })}
        </Text>
        <Row justify="between" align="center">
          {price === null ? (
            <Skeleton width={90} height={18} />
          ) : (
            <Text variant="heading">
              {t('store.gemsAmount', { gems: formatGems(gems(price)) })}
            </Text>
          )}
          {balance !== null && price !== null && !short && (
            <Text variant="caption" tone="secondary">
              {t('store.balanceAfter', { gems: formatGems(gems(balance - price)) })}
            </Text>
          )}
        </Row>
        <Input
          value={body}
          onChangeText={(text) => {
            setBody(text);
            if (failure !== null) setFailure(null);
          }}
          maxLength={terms.data?.maxLength ?? 120}
          multiline
          placeholder={t('room.superPlaceholder')}
          helper={t('room.superChars', { n: body.length, max: terms.data?.maxLength ?? 120 })}
          testID="super-input"
        />
        {failure !== null && (
          <Banner
            message={
              failure instanceof ApiError && failure.code === ApiErrorCode.INSUFFICIENT_BALANCE
                ? t('store.notEnoughGems')
                : errorMessage(failure)
            }
          />
        )}
        {short ? (
          <Button
            label={t('store.getGemsFor', { gems: formatGems(gems(price ?? 0)) })}
            onPress={() => {
              haptic.tap();
              sheet.current?.dismiss();
              onTopUp();
            }}
            size="lg"
            fullWidth
            testID="super-top-up"
          />
        ) : (
          <Button
            label={t('room.superSend')}
            onPress={() => void submit()}
            disabled={!ready}
            loading={send.isPending}
            size="lg"
            fullWidth
            testID="super-send"
          />
        )}
        <Text variant="micro" tone="faint" style={styles.note}>
          {t('room.superNote')}
        </Text>
      </Column>
    </Sheet>
  );
});

const styles = StyleSheet.create({ note: { textAlign: 'center' } });
