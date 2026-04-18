// Dynamic app config that reads environment variables at build time.
// This allows CI to pass EXPO_PUBLIC_API_URL for the E2E test build.
// See: https://docs.expo.dev/workflow/configuration/#dynamic-configuration

// biome-ignore lint/style/noCommonJs: Expo requires CommonJS for app.config.js
module.exports = ({config}) => ({
  ...config,
  extra: {
    ...config.extra,
    // Map EXPO_PUBLIC_API_URL to BASE_URL for @terreno/rtk constants.ts compatibility
    BASE_URL: process.env.EXPO_PUBLIC_API_URL || process.env.BASE_URL || undefined,
  },
});
