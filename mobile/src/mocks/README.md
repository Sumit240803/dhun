# Mock data

Everything the app shows that has no endpoint yet. **One folder, so deleting it
is how you know you are done.**

## The rule

A mock lives here. Nothing else imports from `mocks/` except a query hook in
`api/queries/`, and each of those hooks has exactly one line to change:

```ts
// api/queries/useRooms.ts
export function useLiveRooms(category: RoomCategory) {
  return useQuery({
    queryKey: queryKeys.rooms.feed(category),
    queryFn: () => fromMock(mockRooms(category)), // ← TODO(api): roomsApi.feed(category)
  });
}
```

Screens never import a mock. They call the hook, and they cannot tell the
difference — which is the whole point: when the endpoint lands, the screen does
not change, its loading and error states already exist, and the diff is one line
per resource.

## Shapes are the contract

Every mock is typed against `api/types.ts`, not against itself. If the backend
returns something else, the type breaks here rather than in eight screens. When
you build the endpoint, **start from these types** — they are the spec the UI
was built to.

`fromMock()` adds a short delay on purpose. Without it every screen renders
already-loaded, the skeletons never appear, and nobody notices they are wrong
until the real API is slower than the designer assumed.

## What is mocked, and what will replace it

| File          | Replaced by                                                       | Milestone |
| ------------- | ----------------------------------------------------------------- | --------- |
| `rooms.ts`    | `GET /v1/rooms/feed`                                              | M5        |
| `messages.ts` | `GET /v1/messages/threads`                                        | M5        |
| `events.ts`   | `GET /v1/config/banners` — server-driven, day-1 non-negotiable #6 | M10       |
| `profile.ts`  | `GET /v1/users/me/summary`                                        | M8        |
| `wallet.ts`   | already real — `GET /v1/wallet`, `GET /v1/wallet/packs`           | done      |

`wallet.ts` holds only the numbers a screen needs before a session exists. The
coin packs themselves come from the server today and must never be hardcoded —
day-1 non-negotiable #6, and the packs are the margin dial.

## Photographs

`faces.ts` holds no images. The collage and every room card render tinted
placeholders until there are photographs the company has the rights to use.
Do not paste in stock URLs or scrape a competitor: these are pictures of real
people, and a live-streaming app shipping someone's face without consent is the
kind of story that ends a launch.
