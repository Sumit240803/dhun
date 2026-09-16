import type { UserLook } from '@/api/types';
import { Avatar, type AvatarProps } from '@/ui';
import { assetUrl } from './assets';
import { frameOf } from './look';

/**
 * An avatar drawn as its owner chose to appear.
 *
 * The one place a `UserLook` becomes Avatar props, so every screen that draws a
 * person — a seat, a chat line, a gift strip, a profile — shows the same frame
 * the same way, with the same fallback.
 */
export function LookAvatar({
  frame,
  ...props
}: Omit<AvatarProps, 'frameUri' | 'frameRing'> & { frame: UserLook['frame'] | undefined }) {
  const parts = frameOf(frame);
  return <Avatar {...props} frameUri={assetUrl(parts?.asset)} frameRing={parts?.ring} />;
}
