// Expo's default Metro config, plus the Sentry serializer.
//
// getSentryExpoConfig wraps expo/metro-config's getDefaultConfig and stamps a
// debug ID into every bundle and its source map. That ID is how Sentry matches
// a minified stack trace to the right source map — for the embedded bundle and
// for every OTA update — without depending on release names lining up.
//
// Nothing else is customised here. Anything added must go through this call,
// never replace it, or source maps stop matching.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
