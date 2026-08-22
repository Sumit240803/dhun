// In-process event bus. Modules publish side-effect events here instead of
// calling each other directly. When you later extract a module into its own
// service, swap THIS file to publish to Kafka/RabbitMQ — subscribers move out
// untouched. The rest of the app keeps using publish()/subscribe() unchanged.

type Handler = (payload: unknown) => void | Promise<void>;

class EventBus {
  private handlers = new Map<string, Handler[]>();

  publish(event: string, payload: unknown): void {
    const hs = this.handlers.get(event) ?? [];
    for (const h of hs) {
      Promise.resolve(h(payload)).catch((err) =>
        console.error(`[eventBus] handler for "${event}" failed`, err),
      );
    }
  }

  subscribe(event: string, handler: Handler): void {
    const hs = this.handlers.get(event) ?? [];
    hs.push(handler);
    this.handlers.set(event, hs);
  }
}

export const eventBus = new EventBus();

// Canonical event names so publishers and subscribers can't drift.
export const Events = {
  GiftSent: 'gift.sent',
  CoinsCredited: 'coins.credited',
  UserFollowed: 'user.followed',
  GameSettled: 'game.settled',
} as const;
