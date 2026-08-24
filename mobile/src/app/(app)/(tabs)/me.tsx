import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { formatE164ForDisplay } from '@/features/auth/phone';
import { signOut } from '@/features/auth/session';
import { useTranslation, type LocaleCode, type MessageKey } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { useSession } from '@/store/session';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Column,
  Divider,
  ListItem,
  Row,
  Screen,
  Sheet,
  Text,
  type SheetHandle,
} from '@/ui';

const LEGAL: { href: Href; label: MessageKey; icon: keyof typeof Ionicons.glyphMap }[] = [
  { href: '/legal/terms', label: 'legal.terms', icon: 'document-text-outline' },
  { href: '/legal/privacy', label: 'legal.privacy', icon: 'lock-closed-outline' },
  { href: '/legal/guidelines', label: 'legal.guidelines', icon: 'people-outline' },
  // IT Rules 2021 require the Grievance Officer's contact to be publicly
  // reachable in the app, not only on the website.
  { href: '/legal/grievance', label: 'legal.grievance', icon: 'mail-outline' },
];

export default function MeScreen() {
  const { t, locale, setLocale } = useTranslation();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const signOutSheet = useRef<SheetHandle>(null);
  const [signingOut, setSigningOut] = useState(false);

  const isGuest = user?.status === 'guest';
  const name = user?.displayName ?? t('me.guest');

  async function confirmSignOut() {
    setSigningOut(true);
    haptic.success();
    await signOut();
    // Wallet balances and catalogs belong to the account that just left. Left
    // in cache they would flash in front of whoever signs in next.
    queryClient.clear();
    signOutSheet.current?.dismiss();
    router.replace('/(auth)/index');
  }

  return (
    <Screen padded={false} edges={['top']}>
      <Animated.ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(280)}>
          <Row gap="lg" style={styles.header}>
            <Avatar name={name} size="xl" />
            <Column gap="xs" flex={1}>
              <Text variant="title" numberOfLines={1}>
                {name}
              </Text>
              <Text variant="caption" tone="secondary">
                {user?.phone ? formatE164ForDisplay(user.phone) : t('me.noPhone')}
              </Text>
            </Column>
          </Row>
        </Animated.View>

        {isGuest && (
          <Animated.View entering={FadeInDown.duration(280).delay(60)} style={styles.section}>
            <Card selected>
              <Column gap="md">
                <Text variant="bodyStrong">{t('me.guestBody')}</Text>
                <Button
                  label={t('me.verifyPhone')}
                  onPress={() => {
                    haptic.tap();
                    router.push('/(auth)/index');
                  }}
                  size="sm"
                  testID="verify-phone"
                />
              </Column>
            </Card>
          </Animated.View>
        )}

        <Section title={t('me.account')}>
          <ListItem
            title={t('wallet.title')}
            left={<Glyph name="wallet-outline" />}
            right={<Chevron />}
            onPress={() => {
              haptic.selection();
              router.push('/(app)/(tabs)/wallet');
            }}
          />
          <Divider />
          <ListItem
            title={t('wallet.transactions')}
            left={<Glyph name="receipt-outline" />}
            right={<Chevron />}
            onPress={() => {
              haptic.selection();
              router.push('/(app)/wallet/transactions');
            }}
          />
        </Section>

        <Section title={t('me.preferences')}>
          <ListItem
            title={t('me.language')}
            left={<Glyph name="language-outline" />}
            right={
              <Row gap="xs">
                {(['en', 'hi'] as LocaleCode[]).map((code) => (
                  <Chip
                    key={code}
                    label={code === 'en' ? 'English' : 'हिन्दी'}
                    selected={locale === code}
                    onPress={() => {
                      haptic.selection();
                      setLocale(code);
                    }}
                  />
                ))}
              </Row>
            }
          />
        </Section>

        <Section title={t('me.legalSection')}>
          {LEGAL.map((item, index) => (
            <View key={String(item.href)}>
              {index > 0 && <Divider />}
              <ListItem
                title={t(item.label)}
                left={<Glyph name={item.icon} />}
                right={<Chevron />}
                onPress={() => {
                  haptic.selection();
                  router.push(item.href);
                }}
              />
            </View>
          ))}
        </Section>

        <View style={styles.signOut}>
          <Button
            label={t('me.signOut')}
            onPress={() => {
              haptic.tap();
              signOutSheet.current?.present();
            }}
            variant="ghost"
            fullWidth
            testID="sign-out"
          />
        </View>
      </Animated.ScrollView>

      <Sheet ref={signOutSheet} title={t('me.signOutTitle')}>
        <Text variant="body" tone="secondary">
          {t('me.signOutBody')}
        </Text>
        <Column gap="sm">
          <Button
            label={t('me.signOut')}
            onPress={confirmSignOut}
            loading={signingOut}
            variant="danger"
            fullWidth
            testID="sign-out-confirm"
          />
          <Button
            label={t('common.cancel')}
            onPress={() => signOutSheet.current?.dismiss()}
            variant="ghost"
            fullWidth
          />
        </Column>
      </Sheet>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="micro" tone="faint" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </Text>
      <Card padded={false}>{children}</Card>
    </View>
  );
}

function Glyph({ name }: { name: keyof typeof Ionicons.glyphMap }) {
  return <Ionicons name={name} size={20} color={colors.text.secondary} />;
}

function Chevron() {
  return <Ionicons name="chevron-forward" size={18} color={colors.text.faint} />;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  header: { paddingTop: spacing.lg },
  section: { marginTop: spacing.xl },
  sectionTitle: { marginBottom: spacing.sm, marginLeft: spacing.xs, letterSpacing: 0.6 },
  signOut: { marginTop: spacing.xxl },
});
