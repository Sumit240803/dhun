import { RoomFeed } from '@/features/feed/RoomFeed';

export default function PartyTab() {
  return <RoomFeed sections={['party', 'following']} action="party" />;
}
