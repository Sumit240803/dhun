import { RoomFeed } from '@/features/feed/RoomFeed';

export default function LiveTab() {
  return <RoomFeed sections={['following', 'explore']} action="live" />;
}
