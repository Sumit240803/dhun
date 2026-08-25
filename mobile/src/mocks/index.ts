// The mock layer. See README.md in this folder before adding anything.
//
// Nothing outside `api/queries/` may import from here. That single rule is what
// keeps the swap to real endpoints a one-line change per resource instead of a
// hunt through every screen.

export { fromMock, MOCKS_ENABLED } from './transport';
export { mockRooms, ROOM_CATEGORIES, type MockRoom, type RoomCategory } from './rooms';
export { mockThreads, type MockThread, type ThreadFilter } from './messages';
export { mockBanners, type MockBanner } from './events';
export { mockProfileSummary, type MockProfileSummary } from './profile';
