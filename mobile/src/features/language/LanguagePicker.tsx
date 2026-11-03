import { useMutation } from '@tanstack/react-query';
import { useState, type Ref } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import type { Language } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { sessionStore } from '@/store/session';
import { Banner, Button, Chip, Column, Row, Sheet, Text, type SheetHandle } from '@/ui';

import { LANGUAGE_LABELS, pickerSections, toggleLanguage } from './languages';

/**
 * Pick ONE language — the feed filter, a room's language.
 *
 * The person's own languages come first under their own heading, so the
 * common choice is one tap and never a scan through fourteen scripts. The
 * pick applies at once and closes the sheet; there is nothing to confirm.
 */
export function LanguagePickerSheet({
  ref,
  title,
  value,
  own,
  allowAll,
  onPick,
  testID,
}: {
  ref: Ref<SheetHandle>;
  title: string;
  value: Language | null;
  /** The person's own languages, in their order. May be empty. */
  own: readonly string[];
  /** Offer "All languages" (null). The feed does; a room must have one. */
  allowAll: boolean;
  onPick: (language: Language | null) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { yours, more } = pickerSections(own);

  function pick(next: Language | null) {
    haptic.selection();
    onPick(next);
    if (typeof ref === 'object' && ref?.current) ref.current.dismiss();
  }

  const chip = (code: Language) => (
    <Chip
      key={code}
      label={t(LANGUAGE_LABELS[code])}
      selected={value === code}
      onPress={() => pick(code)}
      testID={`${testID ?? 'language'}-${code}`}
    />
  );

  return (
    <Sheet ref={ref} title={title}>
      <Column gap="lg">
        {allowAll && (
          <Row gap="sm" wrap>
            <Chip
              label={t('language.all')}
              selected={value === null}
              onPress={() => pick(null)}
              testID={`${testID ?? 'language'}-all`}
            />
          </Row>
        )}

        {yours.length > 0 && (
          <Column gap="sm">
            <Text variant="caption" tone="secondary">
              {t('language.yours')}
            </Text>
            <Row gap="sm" wrap>
              {yours.map(chip)}
            </Row>
          </Column>
        )}

        <Column gap="sm">
          {yours.length > 0 && (
            <Text variant="caption" tone="secondary">
              {t('language.more')}
            </Text>
          )}
          <Row gap="sm" wrap>
            {more.map(chip)}
          </Row>
        </Column>
      </Column>
    </Sheet>
  );
}

/**
 * Pick up to three — the languages a person speaks. Inline in profile setup,
 * inside a sheet on the account screen.
 *
 * A fourth tap is refused with a sentence and an error haptic, never by
 * quietly dropping the first choice: that is a decision the person did not
 * make, and they would not notice it had been made.
 */
export function LanguageChips({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly Language[];
  onChange: (next: Language[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [refused, setRefused] = useState(false);
  // Chosen ones first, so what is picked stays in view as the list wraps.
  const { yours, more } = pickerSections(value);

  return (
    <Column gap="sm">
      <Row gap="sm" wrap>
        {[...yours, ...more].map((code) => (
          <Chip
            key={code}
            label={t(LANGUAGE_LABELS[code])}
            selected={value.includes(code)}
            disabled={disabled}
            onPress={() => {
              const result = toggleLanguage(value, code);
              setRefused(result.refused);
              if (result.refused) {
                haptic.error();
                return;
              }
              haptic.selection();
              onChange(result.next);
            }}
            testID={`speaks-${code}`}
          />
        ))}
      </Row>
      <Text variant="caption" tone={refused ? 'danger' : 'faint'}>
        {refused ? t('language.limitReached') : t('language.profileHelp')}
      </Text>
    </Column>
  );
}

/** The account screen's editor: the chips and one Save. */
export function EditLanguagesSheet({
  ref,
  initial,
}: {
  ref: Ref<SheetHandle>;
  initial: readonly Language[];
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<Language[]>([...initial]);

  const save = useMutation({
    mutationFn: () => authApi.updateProfile({ languages: value }),
    onSuccess: ({ user }) => {
      haptic.success();
      sessionStore.signIn(user);
      if (typeof ref === 'object' && ref?.current) ref.current.dismiss();
    },
    onError: () => haptic.error(),
  });

  return (
    <Sheet
      ref={ref}
      title={t('language.editTitle')}
      onDismiss={() => {
        save.reset();
        setValue([...initial]);
      }}
    >
      <Column gap="lg">
        <LanguageChips value={value} onChange={setValue} disabled={save.isPending} />
        {save.isError && (
          <Animated.View entering={FadeIn.duration(160)}>
            <Banner message={errorMessage(save.error)} detail={traceReference(save.error)} />
          </Animated.View>
        )}
        <Button
          label={t('common.save')}
          onPress={() => {
            haptic.tap();
            save.mutate();
          }}
          disabled={value.length === 0}
          loading={save.isPending}
          fullWidth
          testID="save-languages"
        />
      </Column>
    </Sheet>
  );
}
