import FontAwesome from "@expo/vector-icons/FontAwesome";
import {DefaultTheme, ThemeProvider} from "@react-navigation/native";
import * as Sentry from "@sentry/react";
import {useFonts} from "expo-font";
import {Stack} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import type React from "react";
import {useEffect} from "react";
import "react-native-reanimated";
import {baseUrl, useSelectCurrentUserId} from "@terreno/rtk";
import {TerrenoProvider} from "@terreno/ui";
import {Provider} from "react-redux";
import {PersistGate} from "redux-persist/integration/react";
import {persistor, store} from "@/store";

Sentry.init({
  dsn: "https://73dfd26d7a1d38d500ae6a136ab5a0b0@o106257.ingest.us.sentry.io/4511082700341248",
  tracesSampleRate: 1.0,
});

export {ErrorBoundary} from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

// In E2E test builds, EXPO_PUBLIC_SKIP_FONT_WAIT is set at build time to skip
// font loading entirely. This prevents re-renders from font load state changes
// which cause DOM elements to detach and break Playwright interactions.
const skipFontLoad = process.env.EXPO_PUBLIC_SKIP_FONT_WAIT === "true";

if (!skipFontLoad) {
  SplashScreen.preventAutoHideAsync();
}

const RootLayoutNav: React.FC = () => {
  const userId = useSelectCurrentUserId();

  return (
    <ThemeProvider value={DefaultTheme}>
      <Stack>
        {!userId ? (
          <Stack.Screen name="login" options={{headerShown: false}} />
        ) : (
          <Stack.Screen name="(tabs)" options={{headerShown: false}} />
        )}
      </Stack>
    </ThemeProvider>
  );
};

const RootLayout: React.FC = () => {
  // Skip font loading in E2E test builds to prevent re-renders from interfering
  // with Playwright element interactions (elements detach during font load re-renders).
  const [loaded, error] = useFonts(
    skipFontLoad
      ? {}
      : {
          SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
          ...FontAwesome.font,
        }
  );

  // Handle font loading errors
  useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  // Hide splash screen when fonts are loaded
  useEffect(() => {
    if (loaded && !skipFontLoad) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded && !skipFontLoad) {
    return null;
  }

  return (
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <TerrenoProvider openAPISpecUrl={`${baseUrl}/openapi.json`}>
          <RootLayoutNav />
        </TerrenoProvider>
      </PersistGate>
    </Provider>
  );
};

// Expo Router requires default export for route files
export default RootLayout;
