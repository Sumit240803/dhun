// The UI primitive set. Dumb, styled, and knowing nothing about coins or rooms.
//
// A screen imports from '@/ui' and gets everything. Feature-specific components
// (a gift tile, a coin pack card) live in features/, not here — the test is
// whether a component would still make sense in a different app.

export { Screen } from './Screen';
export type { ScreenProps } from './Screen';

export { Row, Column, Spacer } from './Layout';
export type { StackProps } from './Layout';

export { Text } from './Text';
export type { TextProps } from './Text';

export { Button, buttonHeight } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Input } from './Input';
export type { InputProps } from './Input';

export { Card } from './Card';
export type { CardProps } from './Card';

export { ListItem } from './ListItem';
export type { ListItemProps } from './ListItem';

export { Avatar, avatarSize } from './Avatar';
export type { AvatarProps } from './Avatar';

export { Badge } from './Badge';
export type { BadgeProps } from './Badge';

export { Divider } from './Divider';
export type { DividerProps } from './Divider';

export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';

export { ProviderButton } from './ProviderButton';
export type { ProviderButtonProps } from './ProviderButton';

export { Chip } from './Chip';
export type { ChipProps } from './Chip';

export { Banner } from './Banner';
export type { BannerProps } from './Banner';

export { CodeInput } from './CodeInput';
export type { CodeInputProps } from './CodeInput';

export { Sheet } from './Sheet';
export type { SheetProps, SheetHandle } from './Sheet';

export { ErrorBoundary } from './ErrorBoundary';
export { Placeholder } from './Placeholder';
