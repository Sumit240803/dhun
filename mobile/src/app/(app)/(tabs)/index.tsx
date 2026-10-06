import { RoomFeed } from '@/features/feed/RoomFeed';

export default function LiveTab() {
  // Explore first, and therefore the default: a new account follows nobody, so
  // opening on Following would show an empty screen to every first-time user.
  return <RoomFeed sections={['explore', 'following']} action="live" />;
}
