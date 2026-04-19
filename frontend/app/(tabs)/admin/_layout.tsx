import {Stack, router} from "expo-router";
import type React from "react";
import {useCallback} from "react";
import {Platform, Pressable} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {colors} from "@/constants/theme";

/**
 * Admin stack layout. Enables the native stack header so every admin screen
 * gets a consistent title + back button. Per-screen titles are set via
 * `navigation.setOptions` from the individual screens when needed (dynamic
 * model name, etc.); the default title below covers the index screen.
 */
const HeaderBackToProfileButton: React.FC = () => {
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/profile");
  }, []);

  return (
    <Pressable
      accessibilityLabel="Back"
      onPress={handleBack}
      style={{paddingHorizontal: 12, paddingVertical: 6}}
      testID="admin-header-back-button"
    >
      <FontAwesome color={colors.tint} name="chevron-left" size={20} />
    </Pressable>
  );
};

const renderHeaderLeft = (): React.ReactElement => <HeaderBackToProfileButton />;

const AdminStackLayout: React.FC = () => {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitle: "Admin",
        headerTitleAlign: Platform.OS === "ios" ? "center" : "left",
        headerLeft: renderHeaderLeft,
      }}
    />
  );
};

// Expo Router requires default export for route files
export default AdminStackLayout;
