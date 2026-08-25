// How a mock reaches a screen.
//
// Deliberately asynchronous. A mock that resolves synchronously renders every
// screen already-loaded, so the skeletons and empty states are never seen — and
// they are exactly the states that turn out to be wrong once a real network is
// involved. A short delay keeps them honest.

/**
 * Whether the app is running on mock data.
 *
 * Read it to show a development banner, never to branch application logic: a
 * screen that behaves differently under mocks is a screen that was not tested.
 */
export const MOCKS_ENABLED = true;

/** Roughly a fast Indian 4G round trip. Slow enough to see, fast enough to work with. */
const MOCK_LATENCY_MS = 450;

/** Resolves `data` after a beat, the way an endpoint would. */
export function fromMock<T>(data: T, latencyMs: number = MOCK_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), latencyMs));
}
