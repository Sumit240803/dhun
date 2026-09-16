// PUBLIC API of the notifications module.
//
// Push tokens, and the followed-host-is-live notification. Sending goes through
// a PushProvider (console in development, Expo in production), and every send is
// driven by an outbox event consumed in the workers process — never from inside
// an API request, where a slow push service would hold up a user.

export { buildNotificationsRouter } from './notifications.routes.js';
export { clearPushToken, notifyFollowersLive, registerPushToken } from './notifications.service.js';
export {
  ConsolePushProvider,
  getPushProvider,
  setPushProvider,
} from './push.provider.js';
export type { PushMessage, PushOutcome, PushProvider } from './push.provider.js';
