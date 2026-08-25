// PUBLIC API of the chat module.
//
// The READ side only. Sending a message needs the realtime gateway (M5); this
// is the list the app opens on, and it works without one.

export { buildMessagesRouter } from './threads.routes.js';
export { listThreads } from './threads.service.js';
export type { ThreadSummary, ThreadFilter } from './threads.service.js';
