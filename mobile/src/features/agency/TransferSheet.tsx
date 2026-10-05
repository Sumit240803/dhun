import { randomUUID } from 'expo-crypto';
import { useRef, useState, type Ref } from 'react';
import { StyleSheet } from 'react-native';

import { useTransferCoins } from '@/api/queries/useAgency';
import type { AgencyInventory } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorCode, errorMessage, fieldError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { formatCoins } from '@/lib/money';
import { coins as asCoins } from '@/lib/units';
import { spacing } from '@/theme';
import { Banner, Button, Column, Input, Row, Sheet, Text, type SheetHandle } from '@/ui';

/**
 * Sending coins to a user who has already paid the agency off-platform.
 *
 * Two things this screen owes the person using it. The cap it is working to is
 * stated BEFORE they type, because finding out from a rejection is how an
 * agency ends up explaining itself to a waiting customer. And the send is
 * confirmed against the User ID, because coins cannot be taken back and a
 * mistyped digit is somebody else's account.
 */
export function TransferSheet({
  ref,
  inventory,
}: {
  ref: Ref<SheetHandle>;
  inventory: AgencyInventory;
}) {
  const { t } = useTranslation();
  const send = useTransferCoins();
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  // Generated once per attempt and reused on retry, so a dropped connection
  // cannot send the coins twice. A new one only after a send succeeds.
  const requestId = useRef(randomUUID());

  const value = Number(amount || 0);
  const overCap = value > inventory.caps.perTransferMaxCoins;
  const overStock = value > inventory.coins;
  const ready = userId.length === 8 && value > 0 && !overCap && !overStock;

  const limitHit =
    errorCode(send.error) === 'TRANSFER_DAILY_LIMIT' ||
    errorCode(send.error) === 'RECIPIENT_DAILY_LIMIT' ||
    errorCode(send.error) === 'TRANSFER_TOO_LARGE';

  function reset() {
    setConfirming(false);
    send.reset();
  }

  function submit() {
    haptic.tap();
    send.mutate(
      {
        userId: Number(userId),
        coins: value,
        requestId: requestId.current,
        note: note.trim() === '' ? undefined : note.trim(),
      },
      {
        onSuccess: () => {
          haptic.success();
          requestId.current = randomUUID();
          setUserId('');
          setAmount('');
          setNote('');
          setConfirming(false);
          if (typeof ref === 'object' && ref?.current) ref.current.dismiss();
        },
        onError: () => {
          haptic.error();
          setConfirming(false);
        },
      },
    );
  }

  const amountError = overStock
    ? t('agencyCoins.notEnoughStock')
    : overCap
      ? t('agencyCoins.perTransfer', {
          coins: formatCoins(asCoins(inventory.caps.perTransferMaxCoins)),
        })
      : fieldError(send.error, 'coins');

  return (
    <Sheet ref={ref} title={t('agencyCoins.transferTitle')} onDismiss={reset}>
      {confirming ? (
        <Column gap="lg">
          <Column gap="xs">
            <Text variant="heading">
              {t('agencyCoins.confirmTitle', { coins: formatCoins(asCoins(value)) })}
            </Text>
            <Text variant="body" tone="secondary">
              {t('agencyCoins.confirmBody', { id: userId })}
            </Text>
          </Column>
          <Column gap="sm">
            <Button
              label={t('agencyCoins.confirmSend')}
              onPress={submit}
              loading={send.isPending}
              fullWidth
              testID="confirm-transfer"
            />
            <Button
              label={t('agencyCoins.cancel')}
              onPress={() => setConfirming(false)}
              variant="ghost"
              fullWidth
            />
          </Column>
        </Column>
      ) : (
        <Column gap="md">
          <Text variant="caption" tone="secondary">
            {t('agencyCoins.transferBody')}
          </Text>

          <Input
            label={t('agencyCoins.recipientLabel')}
            value={userId}
            onChangeText={(next) => setUserId(next.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={8}
            error={fieldError(send.error, 'userId')}
            testID="transfer-user-id"
          />
          <Input
            label={t('agencyCoins.coinsLabel')}
            value={amount}
            onChangeText={(next) => setAmount(next.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={9}
            helper={t('agencyCoins.perTransfer', {
              coins: formatCoins(asCoins(inventory.caps.perTransferMaxCoins)),
            })}
            error={amountError}
            testID="transfer-coins"
          />
          <Input
            label={t('agencyCoins.noteLabel')}
            helper={t('agencyCoins.noteHelper')}
            value={note}
            onChangeText={setNote}
            maxLength={140}
            testID="transfer-note"
          />

          {send.error != null && amountError === undefined && (
            <Banner
              message={errorMessage(send.error)}
              tone={limitHit ? 'warning' : 'danger'}
              testID="transfer-error"
            />
          )}

          <Row justify="between" style={styles.footer}>
            <Text variant="caption" tone="faint">
              {formatCoins(asCoins(inventory.coins))}
            </Text>
            <Button
              label={t('agencyCoins.send')}
              onPress={() => {
                haptic.selection();
                setConfirming(true);
              }}
              disabled={!ready}
              testID="review-transfer"
            />
          </Row>
        </Column>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  footer: { paddingTop: spacing.xs },
});
