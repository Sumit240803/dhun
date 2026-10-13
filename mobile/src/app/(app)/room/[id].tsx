import { router, useLocalSearchParams } from 'expo-router';

import { isLiveKitAvailable } from '@/features/room/livekit';
import { RoomScreen } from '@/features/room/RoomScreen';
import { useTranslation } from '@/i18n';
import { EmptyState, Screen } from '@/ui';

/**
 * The room route.
 *
 * Composition only — `app/` composes, `features/` holds the logic
 * (mobile/ARCHITECTURE.md). Everything that used to be in this file now lives
 * in `features/room/`, split into chrome, stages and the PK layer, because one
 * screen rendering six different room types in 990 lines had stopped being
 * reviewable.
 *
 * What stays here is the guard below. It decides whether a room can be entered
 * at all, and a route is the right place to answer that before the room's own
 * state machine starts.
 */
export default function RoomRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  // A build made before `@livekit/react-native` was installed has no native
  // module to connect with. Degrading here — rather than letting the room
  // mount and fail — follows the same rule as the SDK loader: a missing native
  // dependency is a degraded feature, never a red screen.
  if (!isLiveKitAvailable()) {
    return (
      <Screen padded>
        <EmptyState
          icon="cloud-offline-outline"
          title={t('room.unavailableTitle')}
          body={t('room.unavailableBody')}
          actionLabel={t('common.back')}
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  if (!id) {
    return (
      <Screen padded>
        <EmptyState
          icon="help-circle-outline"
          title={t('room.missingTitle')}
          body={t('room.missingBody')}
          actionLabel={t('common.back')}
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  return <RoomScreen roomId={id} />;
}
