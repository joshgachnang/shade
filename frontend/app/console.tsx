import {Redirect} from "expo-router";
import type React from "react";

// The console is the home page now (with its panes merged into the app
// sidebar); this route survives only so old /console links keep working.
const ConsoleScreen: React.FC = () => <Redirect href="/" />;

// Expo Router requires default export for route files
export default ConsoleScreen;
