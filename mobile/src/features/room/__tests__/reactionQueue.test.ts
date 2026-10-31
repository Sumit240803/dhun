import { ReactionQueue } from '@/features/room/chrome/reactionQueue';

describe('the reaction queue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows a reaction and lets it go after its lifetime', () => {
    const queue = new ReactionQueue();
    queue.push('heart');
    expect(queue.getSnapshot()).toHaveLength(1);
    expect(queue.getSnapshot()[0]).toMatchObject({ emoji: 'heart' });

    jest.advanceTimersByTime(1_700);
    expect(queue.getSnapshot()).toHaveLength(0);
  });

  it('sheds the oldest in a storm rather than growing without bound', () => {
    const queue = new ReactionQueue();
    for (let i = 0; i < 40; i++) queue.push('fire');
    expect(queue.getSnapshot()).toHaveLength(18);
  });

  it('tells subscribers on every change and spreads reactions across the lane', () => {
    const queue = new ReactionQueue();
    const listener = jest.fn();
    queue.subscribe(listener);
    queue.push('clap');
    queue.push('wow');
    expect(listener).toHaveBeenCalledTimes(2);
    for (const item of queue.getSnapshot()) {
      expect(item.lane).toBeGreaterThanOrEqual(0);
      expect(item.lane).toBeLessThan(1);
    }
    queue.clear();
    expect(queue.getSnapshot()).toHaveLength(0);
  });
});
