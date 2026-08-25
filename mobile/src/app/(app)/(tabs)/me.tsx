import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { router, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useProfileSummary } from '@/api/queries/useFeed';
import { useWallet } from '@/api/queries/useWallet';
import { signOut } from '@/features/auth/session';
import { useTranslation, type LocaleCode, type MessageKey } from '@/i18n';
import { formatCoins, formatPoints } from '@/lib/money';
import { coins, points } from '@/lib/units';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { useSession } from '@/store/session';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  Column,
  Divider,
  ListItem,
  Row,
  Screen,
  Sheet,
  Skeleton,
  Text,
  useTabBarHeight,
  type SheetHandle,
} from '@/ui';

type IconName = keyof typeof Ionicons.glyphMap;

const ACTIONS: { key: MessageKey; icon: IconName; tint: string; href?: Href }[] = [
  { key: 'profile.reward', icon: 'gift', tint: colors.brand.solid },
  { key: 'profile.rank', icon: 'trophy', tint: colors.currency.coin },
  { key: 'profile.store', icon: 'bag-handle', tint: colors.currency.gem },
  { key: 'profile.verification', icon: 'shield-checkmark', tint: colors.status.success },
  { key: 'profile.vip', icon: 'diamond', tint: colors.tier[4] },
];

const LEGAL: { href: Href; label: MessageKey; icon: IconName }[] = [
  { href: '/legal/terms', label: 'legal.terms', icon: 'document-text-outline' },
  { href: '/legal/privacy', label: 'legal.privacy', icon: 'lock-closed-outline' },
  { href: '/legal/guidelines', label: 'legal.guidelines', icon: 'people-outline' },
  // IT Rules 2021 require the Grievance Officer's contact to be publicly
  // reachable in the app, not only on the website.
  { href: '/legal/grievance', label: 'legal.grievance', icon: 'mail-outline' },
];

export default function MeTab() {
  const { t, locale, setLocale } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const summary = useProfileSummary();
  const wallet = useWallet();
  const tabBarHeight = useTabBarHeight();

  const signOutSheet = useRef<SheetHandle>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [copied, setCopied] = useState(false);

  const isGuest = user?.status === 'guest';
  const name = user?.displayName ?? t('me.guest');

  async function copyId() {
    if (summary.data === undefined) return;
    await Clipboard.setStringAsync(summary.data.publicId);
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function confirmSignOut() {
    setSigningOut(true);
    haptic.success();
    await signOut();
    // Balances, feed and threads all belong to the account that just left.
    // Left in cache they would flash in front of whoever signs in next.
    queryClient.clear();
    signOutSheet.current?.dismiss();
    router.replace('/(auth)');
  }

  return (
    <Screen padded={false} edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: tabBarHeight + spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={[colors.brand.soft, colors.bg.base]}
          style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}
        >
          <Animated.View entering={FadeInDown.duration(280)} style={styles.heroContent}>
            <Avatar name={name} size="xl" />
            <Row gap="sm">
              <Text variant="title" numberOfLines={1}>
                {name}
              </Text>
              {summary.data?.vipTier != null && <Badge label={t('profile.vip')} tier={4} />}
            </Row>

            <Row gap="xs">
              {summary.isLoading ? (
                <Skeleton width={120} height={20} rounding="pill" />
              ) : (
                <>
                  <Badge label={t('profile.levelUser', { level: summary.data?.userLevel ?? 1 })} />
                  {summary.data?.hostLevel != null && (
                    <Badge
                      label={t('profile.levelHost', { level: summary.data.hostLevel })}
                      tone="success"
                    />
                  )}
                  <Badge
                    label={
                      summary.data?.verified ? t('profile.verified') : t('profile.notVerified')
                    }
                    tone={summary.data?.verified ? 'success' : 'neutral'}
                  />
                </>
              )}
            </Row>

            <Pressable
              onPress={copyId}
              accessibilityRole="button"
              accessibilityLabel={t('profile.idLabel', { id: summary.data?.publicId ?? '' })}
              hitSlop={spacing.sm}
            >
              <Row gap="xs">
                <Text variant="caption" tone="secondary">
                  {t('profile.idLabel', { id: summary.data?.publicId ?? '—' })}
                </Text>
                <Ionicons name="copy-outline" size={13} color={colors.text.faint} />
              </Row>
            </Pressable>

            {copied && (
              <Animated.View entering={FadeIn.duration(140)}>
                <Text variant="micro" tone="brand">
                  {t('profile.copyId')}
                </Text>
              </Animated.View>
            )}
          </Animated.View>
        </LinearGradient>

        <View style={styles.gutter}>
          {isGuest && (
            <Card selected>
              <Column gap="md">
                <Text variant="bodyStrong">{t('me.guestBody')}</Text>
                <Button
                  label={t('me.verifyPhone')}
                  onPress={() => {
                    haptic.tap();
                    router.push('/(auth)');
                  }}
                  size="sm"
                  testID="verify-phone"
                />
              </Column>
            </Card>
          )}

          <Card padded={false}>
            <ListItem
              title={t('profile.visitors')}
              subtitle={
                summary.data === undefined
                  ? undefined
                  : t('profile.newVisitors', { count: summary.data.newVisitors })
              }
              left={<Ionicons name="eye-outline" size={20} color={colors.text.secondary} />}
              right={<Ionicons name="chevron-forward" size={18} color={colors.text.faint} />}
              onPress={() => haptic.selection()}
            />
            <Divider />
            <Row style={styles.stats}>
              <Stat label={t('profile.friends')} value={summary.data?.friends} />
              <Stat label={t('profile.following')} value={summary.data?.following} />
              <Stat label={t('profile.followers')} value={summary.data?.followers} />
            </Row>
          </Card>

          {/*
            Coins and points side by side, in their reserved currency colours.
            They are deliberately NOT interchangeable: coins are spent on gifts,
            points are what a host withdraws as rupees, and a user confusing the
            two is a support ticket at best.
          */}
          <Row gap="md">
            <BalanceCard
              label={t('wallet.coins')}
              value={wallet.data === undefined ? undefined : formatCoins(coins(wallet.data.coins))}
              tint={colors.currency.coin}
              soft={colors.currency.coinSoft}
              icon="ellipse"
              actionLabel={t('profile.topUp')}
              onAction={() => {
                haptic.tap();
                router.push('/(app)/wallet');
              }}
              testID="coins-card"
            />
            <BalanceCard
              label={t('wallet.title')}
              value={
                summary.data === undefined ? undefined : formatPoints(points(summary.data.points))
              }
              tint={colors.currency.point}
              soft={colors.currency.pointSoft}
              icon="cash"
              actionLabel={t('profile.withdraw')}
              onAction={() => haptic.selection()}
              testID="points-card"
            />
          </Row>

          <Card padded={false}>
            <Row style={styles.actions} wrap>
              {ACTIONS.map((action) => (
                <Pressable
                  key={action.key}
                  onPress={() => haptic.selection()}
                  accessibilityRole="button"
                  accessibilityLabel={t(action.key)}
                  style={styles.action}
                >
                  <View style={[styles.actionGlyph, { backgroundColor: colors.bg.raised }]}>
                    <Ionicons name={action.icon} size={22} color={action.tint} />
                  </View>
                  <Text variant="micro" tone="secondary" numberOfLines={1}>
                    {t(action.key)}
                  </Text>
                </Pressable>
              ))}
            </Row>
          </Card>

          <Section title={t('me.preferences')}>
            <ListItem
              title={t('me.language')}
              left={<Ionicons name="language-outline" size={20} color={colors.text.secondary} />}
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
                  left={<Ionicons name={item.icon} size={20} color={colors.text.secondary} />}
                  right={<Ionicons name="chevron-forward" size={18} color={colors.text.faint} />}
                  onPress={() => {
                    haptic.selection();
                    router.push(item.href);
                  }}
                />
              </View>
            ))}
          </Section>

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
      </ScrollView>

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

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <Column align="center" gap="xs" flex={1}>
      {value === undefined ? (
        <Skeleton width={28} height={22} />
      ) : (
        <Text variant="heading">{value}</Text>
      )}
      <Text variant="micro" tone="faint">
        {label}
      </Text>
    </Column>
  );
}

function BalanceCard({
  label,
  value,
  tint,
  soft,
  icon,
  actionLabel,
  onAction,
  testID,
}: {
  label: string;
  value?: string;
  tint: string;
  soft: string;
  icon: IconName;
  actionLabel: string;
  onAction: () => void;
  testID?: string;
}) {
  return (
    <View style={[styles.balance, { backgroundColor: soft }]} testID={testID}>
      <Row gap="xs">
        <Ionicons name={icon} size={14} color={tint} />
        {value === undefined ? (
          <Skeleton width={54} height={20} />
        ) : (
          <Text variant="heading" style={{ color: tint }}>
            {value}
          </Text>
        )}
      </Row>
      <Row justify="between">
        <Text variant="micro" tone="secondary">
          {label}
        </Text>
        <Pressable onPress={onAction} accessibilityRole="button" accessibilityLabel={actionLabel}>
          <View style={styles.balanceAction}>
            <Text variant="micro" style={{ color: tint }}>
              {actionLabel}
            </Text>
          </View>
        </Pressable>
      </Row>
    </View>
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

const styles = StyleSheet.create({
  hero: { paddingBottom: spacing.xl },
  heroContent: { alignItems: 'center', gap: spacing.sm },
  gutter: { paddingHorizontal: spacing.lg, gap: spacing.lg, marginTop: -spacing.sm },
  stats: { paddingVertical: spacing.lg },
  balance: { flex: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  balanceAction: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.surface,
  },
  actions: { padding: spacing.lg, rowGap: spacing.lg },
  action: { width: '20%', alignItems: 'center', gap: spacing.xs },
  actionGlyph: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: spacing.sm },
  sectionTitle: { marginLeft: spacing.xs, letterSpacing: 0.6 },
});
