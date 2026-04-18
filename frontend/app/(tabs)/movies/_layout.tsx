import {Stack} from "expo-router";
import type React from "react";

const MoviesStackLayout: React.FC = () => {
  return <Stack screenOptions={{headerShown: false}} />;
};

// Expo Router requires default export for route files
export default MoviesStackLayout;
