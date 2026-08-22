import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useCallback, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react';
import { StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui/Text';

export interface SheetHandle {
  present: () => void;
  dismiss: () => void;
}

export interface SheetProps {
  children: ReactNode;
  /** Already-translated heading. Omit for a sheet that draws its own header. */
  title?: string;
  /**
   * Heights, as percentages or points. Omitted means the sheet sizes to its
   * content — which is what a short confirmation wants.
   */
  snapPoints?: (string | number)[];
  onDismiss?: () => void;
  /** Off for a sheet that must be resolved, like an age gate. */
  dismissible?: boolean;
  ref?: Ref<SheetHandle>;
}

/**
 * Bottom sheet, wrapping @gorhom/bottom-sheet.
 *
 * The wrapper exists so the styling, the backdrop and the handle live in one
 * place: this app is sheet-heavy — gift tray, profile card, comment input,
 * wallet — and forty sheets configured individually will not match.
 *
 * Requires BottomSheetModalProvider and GestureHandlerRootView at the root;
 * both are wired in app/_layout.tsx.
 */
export function Sheet({
  children,
  title,
  snapPoints,
  onDismiss,
  dismissible = true,
  ref,
}: SheetProps) {
  const modal = useRef<BottomSheetModal>(null);

  useImperativeHandle(ref, () => ({
    present: () => modal.current?.present(),
    dismiss: () => modal.current?.dismiss(),
  }));

  const backdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior={dismissible ? 'close' : 'none'}
      />
    ),
    [dismissible],
  );

  return (
    <BottomSheetModal
      ref={modal}
      snapPoints={snapPoints}
      enableDynamicSizing={snapPoints === undefined}
      enablePanDownToClose={dismissible}
      onDismiss={onDismiss}
      backdropComponent={backdrop}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetView style={styles.content}>
        {title !== undefined && (
          <Text variant="heading" tone="primary">
            {title}
          </Text>
        )}
        {children}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: colors.bg.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  handle: { backgroundColor: colors.border.strong, width: 36 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    // Clears the home indicator without a safe-area hook — BottomSheetView is
    // already inset-aware on the sides but not the bottom.
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
});
