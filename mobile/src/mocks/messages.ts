// Conversation threads.
//
// TODO(api): GET /v1/messages/threads?filter= — M5. Match this shape.

export type ThreadFilter = 'all' | 'official' | 'unread' | 'groups';

export interface MockThread {
  id: string;
  title: string;
  /** Last message, already truncated by the server to keep the list payload small. */
  preview: string;
  /** ISO 8601. The list formats it — never send a pre-formatted string. */
  updatedAt: string;
  unread: number;
  /**
   * Platform-sent, not user-sent. Carries a badge and cannot be blocked or
   * deleted, which is how payout notices and security alerts stay reachable.
   */
  official: boolean;
  group: boolean;
  avatarUrl: string | null;
  /** Tints the fallback avatar so official threads are distinguishable at a glance. */
  accent: 'money' | 'security' | 'system' | 'person';
}

const THREADS: MockThread[] = [
  {
    id: 't_income',
    title: 'Income Reminder',
    preview: 'Congratulations on completing Log in daily. 100 coins have been added.',
    updatedAt: '2026-08-25T00:26:00+05:30',
    unread: 1,
    official: true,
    group: false,
    avatarUrl: null,
    accent: 'money',
  },
  {
    id: 't_security',
    title: 'Account Security Center',
    preview: 'Your account has been logged in. Please confirm it was you.',
    updatedAt: '2026-08-25T00:25:00+05:30',
    unread: 1,
    official: true,
    group: false,
    avatarUrl: null,
    accent: 'security',
  },
];

export function mockThreads(filter: ThreadFilter): MockThread[] {
  switch (filter) {
    case 'official':
      return THREADS.filter((thread) => thread.official);
    case 'unread':
      return THREADS.filter((thread) => thread.unread > 0);
    case 'groups':
      // Empty on purpose: a new user belongs to no groups, and that empty state
      // has to say what to do next rather than showing nothing.
      return [];
    default:
      return THREADS;
  }
}
