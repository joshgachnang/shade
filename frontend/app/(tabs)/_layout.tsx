import {SidebarNavigation} from "@terreno/ui";
import type React from "react";

const SidebarLayout: React.FC = () => {
  return (
    <SidebarNavigation
      topItems={[
        {label: "Home", route: "index", iconName: "house"},
        {label: "Search", route: "search", iconName: "magnifying-glass"},
        {label: "Movies", route: "movies", iconName: "film"},
      ]}
      bottomItems={[
        {label: "Admin", route: "admin", iconName: "gear"},
        {label: "Profile", route: "profile", iconName: "user"},
      ]}
    >
      <SidebarNavigation.Screen name="index" options={{title: "Home"}} />
      <SidebarNavigation.Screen name="search" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="profile" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="movies" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="admin" options={{headerShown: false}} />
    </SidebarNavigation>
  );
};

// Expo Router requires default export for route files
export default SidebarLayout;
