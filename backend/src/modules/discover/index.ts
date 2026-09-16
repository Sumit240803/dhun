// PUBLIC API of the discover module: finding people and live rooms.

export { buildDiscoverRouter } from './discover.routes.js';
export { search } from './search.service.js';
export type { PersonResult, RoomResult } from './search.service.js';
