import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '@/i18n';
import { reportError } from '@/lib/reporting';
import { colors, radius, spacing, typography } from '@/theme';

interface Props {
  children: ReactNode;
  /** Named in the crash report, so a room failure is distinguishable from a wallet one. */
  screen?: string;
  /** Rendered instead of the default panel. Used for boundaries inside a live room. */
  fallback?: (reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render error and shows something recoverable instead of a white screen.
 *
 * **Use these in layers, not just at the root.** A single top-level boundary means
 * a failed gift animation takes down the entire room — including the video the
 * host is streaming. A boundary around the animation layer keeps the stream alive
 * and loses only the effect.
 *
 * Class component because React still has no hook equivalent for
 * componentDidCatch.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportError(error, {
      screen: this.props.screen,
      componentStack: info.componentStack ?? undefined,
    });
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset);

    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t('errors.title')}</Text>
        <Text style={styles.body}>{t('errors.body')}</Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={this.reset}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{t('errors.tryAgain')}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.base,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  title: { ...typography.heading, color: colors.text.primary, textAlign: 'center' },
  body: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.brand.solid,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  buttonPressed: { backgroundColor: colors.brand.pressed },
  buttonText: { ...typography.bodyStrong, color: colors.text.inverse },
});
