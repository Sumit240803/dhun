import { View, type ViewProps } from 'react-native';

import { spacing } from '@/theme';

type Gap = keyof typeof spacing;
type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

const alignMap = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
} as const;

const justifyMap = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
} as const;

export interface StackProps extends ViewProps {
  gap?: Gap;
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
  flex?: number;
}

/**
 * Horizontal and vertical layout.
 *
 * `gap` only accepts a key from the spacing scale, so an arbitrary 13px gap is
 * a type error. That constraint is the whole point — it is what keeps forty
 * screens visually consistent without anyone measuring anything.
 */
export function Row({ gap, align = 'center', justify, wrap, flex, style, ...rest }: StackProps) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: alignMap[align],
          ...(gap !== undefined && { gap: spacing[gap] }),
          ...(justify !== undefined && { justifyContent: justifyMap[justify] }),
          ...(wrap && { flexWrap: 'wrap' as const }),
          ...(flex !== undefined && { flex }),
        },
        style,
      ]}
      {...rest}
    />
  );
}

export function Column({ gap, align, justify, flex, style, ...rest }: StackProps) {
  return (
    <View
      style={[
        {
          flexDirection: 'column',
          ...(gap !== undefined && { gap: spacing[gap] }),
          ...(align !== undefined && { alignItems: alignMap[align] }),
          ...(justify !== undefined && { justifyContent: justifyMap[justify] }),
          ...(flex !== undefined && { flex }),
        },
        style,
      ]}
      {...rest}
    />
  );
}

/** Pushes siblings apart inside a Row or Column. */
export function Spacer({ size }: { size?: Gap }) {
  return (
    <View
      style={size === undefined ? { flex: 1 } : { height: spacing[size], width: spacing[size] }}
    />
  );
}
