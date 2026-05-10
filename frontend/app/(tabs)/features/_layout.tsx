import {Stack} from "expo-router";
import type React from "react";

const FeaturesStackLayout: React.FC = () => {
  return <Stack screenOptions={{headerShown: false}} />;
};

// Expo Router requires default export for route files
export default FeaturesStackLayout;
