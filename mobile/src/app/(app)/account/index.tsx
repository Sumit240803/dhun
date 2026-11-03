import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EditLanguagesSheet } from '@/features/language/LanguagePicker';
import { isLanguage, LANGUAGE_LABELS } from '@/features/language/languages';
import { useTranslation, type MessageKey } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { useSession } from '@/store/session';
import { Card, Column, Divider, ListItem, Row, Screen, Text, type SheetHandle } from '@/ui';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Account and security.
 *
 * Its own screen rather than more rows on Me: these are the actions someone
 * arrives looking for — usually while worried — and they should not have to
 * scroll past their coin balance to find them.
 */
export default function AccountScreen() {
  const { t } = useTranslation();
  const { user } = useSession();

  // A phone-only account has no password to change. Showing the row anyway
  // would lead to a screen whose only content is "this does not apply to you".
  const hasPassword = user?.email != null;
  const languages = (user?.languages ?? []).filter(isLanguage);
  const languageSheet = useRef<SheetHandle>(null);

  const rows: {
    href: Href;
    title: MessageKey;
    subtitle: MessageKey;
    icon: IconName;
    show: boolean;
    testID: string;
  }[] = [
    {
      href: '/(app)/account/password',
      title: 'account.password',
      subtitle: 'account.passwordSubtitle',
      icon: 'key-outline',
      show: hasPassword,
      testID: 'account-password',
    },
    {
      href: '/(app)/account/phone',
      title: 'account.phone',
      subtitle: 'account.phoneSubtitle',
      icon: 'call-outline',
      show: true,
      testID: 'account-phone',
    },
    {
      href: '/(app)/account/sessions',
      title: 'account.sessions',
      subtitle: 'account.sessionsSubtitle',
      icon: 'phone-portrait-outline',
      show: true,
      testID: 'account-sessions',
    },
    {
      href: '/(app)/account/spending',
      title: 'account.spending',
      subtitle: 'account.spendingSubtitle',
      icon: 'speedometer-outline',
      show: true,
      testID: 'account-spending',
    },
  ];

  const visible = rows.filter((row) => row.show);

  return (
    <Screen padded={false} edges={['top']}>
      <Row style={styles.header} gap="md">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={spacing.md}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text.primary} />
        </Pressable>
        <Text variant="heading">{t('account.title')}</Text>
      </Row>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(280)}>
          <Card padded={false}>
            {visible.map((row, index) => (
              <View key={String(row.href)}>
                {index > 0 && <Divider />}
                <ListItem
                  title={t(row.title)}
                  subtitle={t(row.subtitle)}
                  left={<Ionicons name={row.icon} size={20} color={colors.text.secondary} />}
                  right={<Ionicons name="chevron-forward" size={18} color={colors.text.faint} />}
                  onPress={() => {
                    haptic.selection();
                    router.push(row.href);
                  }}
                  testID={row.testID}
                />
              </View>
            ))}
          </Card>
        </Animated.View>

        {/*
          The languages they speak — set at signup, changed here. Every account
          made before migration 040 starts empty, and this is where it fills.
        */}
        <Animated.View entering={FadeInDown.duration(280).delay(30)}>
          <Card padded={false}>
            <ListItem
              title={t('language.accountRow')}
              subtitle={
                languages.length === 0
                  ? t('language.accountRowEmpty')
                  : languages.map((code) => t(LANGUAGE_LABELS[code])).join(', ')
              }
              left={<Ionicons name="language-outline" size={20} color={colors.text.secondary} />}
              right={<Ionicons name="chevron-forward" size={18} color={colors.text.faint} />}
              onPress={() => {
                haptic.selection();
                languageSheet.current?.present();
              }}
              testID="account-languages"
            />
          </Card>
        </Animated.View>

        {/*
          Separated from the rest by a gap and its own card, not merely coloured
          red at the bottom of a list. Deletion is permanent and unlike every
          other row here — the layout should say so before the copy does.
        */}
        <Animated.View entering={FadeInDown.duration(280).delay(60)}>
          <Column gap="sm">
            <Card padded={false}>
              <ListItem
                title={t('account.deleteRow')}
                subtitle={t('account.deleteRowSubtitle')}
                left={<Ionicons name="trash-outline" size={20} color={colors.status.danger} />}
                right={<Ionicons name="chevron-forward" size={18} color={colors.text.faint} />}
                onPress={() => {
                  haptic.selection();
                  router.push('/(app)/account/delete');
                }}
                testID="account-delete"
              />
            </Card>
          </Column>
        </Animated.View>
      </ScrollView>

      {/* Keyed on the saved list so reopening after a save starts from it. */}
      <EditLanguagesSheet ref={languageSheet} initial={languages} key={languages.join(',')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
});
