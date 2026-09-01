// PUBLIC API of the chat module.
//
// Reading and marking read. SENDING a message needs the realtime gateway (M5);
// everything here works without one.

export { buildMessagesRouter } from './threads.routes.js';
export { listThreads, listMessages, markThreadRead } from './threads.service.js';
export type { ThreadSummary, ThreadFilter, ThreadMessage } from './threads.service.js';
