# Dhun — mobile app (Expo SDK 57)

**Expo changes fast. Read the versioned docs at https://docs.expo.dev/versions/v57.0.0/
before writing code against an Expo API.**

Project rules live in the repository root `CLAUDE.md` — hard rules, economy constants,
engineering standards, and `docs/build-plan.md` which governs what gets built when.

## This app specifically

- **Expo SDK 57** · React Native 0.86 · React 19.2 · expo-router with typed routes.
- **Development build required, not Expo Go.** RTC and in-app purchases are native
  modules, so Expo Go cannot load them. Use `expo-dev-client` + EAS Build.
- Routes live in `src/app/` (this template's convention, not the older `app/`).
- `Stack.Protected` guards authenticated routes — declarative, and it cleans navigation
  history automatically. Do not hand-roll redirect effects.
- Tokens go in `expo-secure-store`, never `AsyncStorage`.
- **Every money action generates its idempotency key ONCE, when the user taps** — then
  persists it and reuses it for every retry. A key generated per request is useless.
