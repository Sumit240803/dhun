import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

export interface SearchBarProps {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  onSubmit?: () => void;
  /** Renders as a button instead of a field — for a header that opens a search screen. */
  readOnly?: boolean;
  onPress?: () => void;
  testID?: string;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder,
  onSubmit,
  readOnly = false,
  onPress,
  testID,
}: SearchBarProps) {
  const content = (
    <>
      <Ionicons name="search" size={18} color={colors.text.faint} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text.faint}
        selectionColor={colors.brand.solid}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        editable={!readOnly}
        // A read-only bar must not steal the tap from the Pressable wrapping it.
        pointerEvents={readOnly ? 'none' : 'auto'}
        accessibilityLabel={placeholder}
        style={styles.input}
      />
    </>
  );

  if (readOnly) {
    return (
      <Pressable
        onPress={onPress}
        testID={testID}
        accessibilityRole="search"
        accessibilityLabel={placeholder}
        style={styles.bar}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={styles.bar} testID={testID}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.raised,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text.primary,
    padding: 0,
  },
});
