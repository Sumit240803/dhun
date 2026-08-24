// jest-expo, not vitest: it ships the RN transform, module mocks and asset
// handling that a React Native project needs. One runner covers both the pure
// helpers in lib/ and component tests.
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Reanimated 4 reaches for the native worklets module at import time, which
  // does not exist under jest. This resolver — shipped by the library for
  // exactly this — strips the `.native` extension so the JS implementation
  // loads instead. Without it, importing any component that animates fails the
  // whole suite before a single assertion runs.
  resolver: '<rootDir>/node_modules/react-native-worklets/jest/resolver.js',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg))',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/app/**'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
