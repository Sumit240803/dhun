import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Banner, Button, Chip, Column, Input, Row, Sheet, Text, type SheetHandle } from '@/ui';

interface Props {
  durations: number[];
  defaultSeconds: number;
  pending: boolean;
  error: unknown;
  onCreate: (input: { question: string; options: string[]; durationSeconds: number }) => void;
}

const MAX_OPTIONS = 4;

/**
 * The host writes a question and two to four answers, picks how long it runs,
 * and asks. Nothing here costs anything — a poll is a question, not a game.
 */
export const CreatePollSheet = forwardRef<SheetHandle, Props>(function CreatePollSheet(
  { durations, defaultSeconds, pending, error, onCreate },
  ref,
) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [seconds, setSeconds] = useState(defaultSeconds);

  const filled = options.map((o) => o.trim()).filter((o) => o !== '');
  const distinct = new Set(filled.map((o) => o.toLowerCase())).size === filled.length;
  const ready = question.trim() !== '' && filled.length >= 2 && distinct && !pending;

  function setOption(index: number, text: string) {
    setOptions((current) => current.map((o, i) => (i === index ? text : o)));
  }

  return (
    <Sheet ref={ref} title={t('room.pollTitle')}>
      <Column gap="md">
        <Input
          label={t('room.pollQuestion')}
          value={question}
          onChangeText={setQuestion}
          maxLength={120}
          placeholder={t('room.pollQuestionPlaceholder')}
          testID="poll-question"
        />
        <Column gap="sm">
          {options.map((option, index) => (
            <Row key={index} gap="sm" align="center">
              <View style={styles.flex}>
                <Input
                  value={option}
                  onChangeText={(text) => setOption(index, text)}
                  maxLength={40}
                  placeholder={t('room.pollOption', { n: index + 1 })}
                  testID={`poll-option-input-${index}`}
                />
              </View>
              {options.length > 2 && (
                <Pressable
                  onPress={() => {
                    haptic.selection();
                    setOptions((current) => current.filter((_, i) => i !== index));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.remove')}
                  hitSlop={spacing.sm}
                  style={styles.remove}
                >
                  <Ionicons name="close" size={18} color={colors.text.secondary} />
                </Pressable>
              )}
            </Row>
          ))}
          {options.length < MAX_OPTIONS && (
            <Pressable
              onPress={() => {
                haptic.selection();
                setOptions((current) => [...current, '']);
              }}
              accessibilityRole="button"
              style={styles.add}
              testID="poll-add-option"
            >
              <Ionicons name="add" size={16} color={colors.brand.accent} />
              <Text variant="caption" tone="brand">
                {t('room.pollAddOption')}
              </Text>
            </Pressable>
          )}
          {!distinct && (
            <Text variant="caption" tone="danger">
              {t('room.pollOptionsDiffer')}
            </Text>
          )}
        </Column>

        <Column gap="xs">
          <Text variant="caption" tone="secondary">
            {t('room.pollDuration')}
          </Text>
          <Row gap="xs">
            {durations.map((d) => (
              <Chip
                key={d}
                label={
                  d < 60
                    ? t('room.pollSeconds', { n: d })
                    : t('room.pollMinutes', { n: Math.round(d / 60) })
                }
                selected={seconds === d}
                onPress={() => {
                  haptic.selection();
                  setSeconds(d);
                }}
              />
            ))}
          </Row>
        </Column>

        {error != null && (
          <Banner message={String((error as { message?: string }).message ?? '')} />
        )}

        <Button
          label={t('room.pollCreate')}
          onPress={() => {
            haptic.tap();
            onCreate({ question: question.trim(), options: filled, durationSeconds: seconds });
          }}
          disabled={!ready}
          loading={pending}
          size="lg"
          fullWidth
          testID="poll-create"
        />
      </Column>
    </Sheet>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
});
