import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme';
import { assetUrl } from '@/visuals/assets';

/**
 * The scene a room sits on.
 *
 * Server-driven: the room payload carries a PATH (`rooms/backgrounds/…`) and
 * this resolves it against the asset base, exactly as gift art is resolved.
 * Adding backdrops is a config edit on the server — no app release, day-1
 * non-negotiable #6 — so this component never learns their names.
 *
 * ── Why the scrim is not optional ───────────────────────────────────────────
 *
 * The room's chrome is white text (`tone="onMedia"`), and a backdrop is an
 * arbitrary image chosen by whoever adds the next one. A bright noon sky would
 * make the header unreadable, and nobody is going to contrast-check every
 * future upload against every label.
 *
 * So the scrim guarantees the floor instead of asking the art to: darkest at
 * the top and bottom where the chrome lives, lightest across the middle where
 * the seats are and where the picture is actually worth seeing. It is the same
 * `bg.videoScrim` the theme already defines for text over video — a backdrop is
 * just video that holds still.
 *
 * `base` sits underneath so the room is never briefly transparent while the
 * image decodes, and `transition` fades it in rather than snapping, because a
 * backdrop appearing with a bang reads as a glitch.
 */
export function RoomBackground({ path }: { path: string | null | undefined }) {
  const uri = assetUrl(path);

  return (
    // Never touchable. The seats, the chat and the gift button all live above
    // this, and a backdrop that swallowed a tap on a seat would be a bug
    // nobody would think to look for here.
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="room-backdrop">
      <View style={[StyleSheet.absoluteFill, styles.base]} />

      {uri !== null && (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={220}
          // Cached across rooms: a viewer hopping through a feed meets the
          // same three backdrops repeatedly, and re-fetching one each time is
          // the kind of waste that shows up on a 3G connection.
          cachePolicy="memory-disk"
          // Decoration. A screen reader announcing "image" before the room's
          // title is noise.
          accessible={false}
          testID="room-backdrop-image"
        />
      )}

      {uri !== null && (
        <LinearGradient
          colors={[
            colors.bg.videoScrim,
            colors.bg.videoScrimTransparent,
            colors.bg.videoScrimTransparent,
            colors.bg.videoScrim,
          ]}
          // The clear band is deliberately off-centre: the header is short and
          // the seat bar, composer and gift button stack up at the bottom, so
          // the lower scrim has to start climbing earlier than the upper one
          // stops.
          locations={[0, 0.22, 0.58, 1]}
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Dark in both palettes, because every room draws white chrome over it. A
  // room with no backdrop is a dark room, not an ivory one.
  base: { backgroundColor: colors.bg.scrim },
});
