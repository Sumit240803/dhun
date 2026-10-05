import { useTranslation } from '@/i18n';
import { formatCoins } from '@/lib/money';
import { coins as asCoins } from '@/lib/units';
import { Badge, Column, Row, Text } from '@/ui';

import { formatDay, personName } from './format';

import type { CoinTransfer } from '@/api/types';

/**
 * One line of the transfer record, read from either end.
 *
 * The same row serves the agency's history and the user's, because it is the
 * same row in the database — append-only, and the only thing either side has
 * if they later disagree about a payment made off-platform.
 */
export function TransferRow({
  transfer,
  locale,
  outgoing,
}: {
  transfer: CoinTransfer;
  locale: string;
  outgoing: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Row justify="between" gap="md">
      <Column gap="xs" flex={1}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {outgoing
            ? t('agencyCoins.sentTo', {
                name: personName(transfer.recipient),
                id: transfer.recipient.publicId,
              })
            : t('agencyCoins.receivedFrom', { agency: transfer.agency.name })}
        </Text>
        <Text variant="micro" tone="faint">
          {formatDay(transfer.createdAt, locale)}
          {transfer.note !== null ? ` · ${transfer.note}` : ''}
        </Text>
      </Column>
      <Badge label={formatCoins(asCoins(transfer.coins))} tone="coin" />
    </Row>
  );
}
