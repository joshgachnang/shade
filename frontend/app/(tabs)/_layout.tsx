import {SidebarNavigation} from "@terreno/ui";
import type React from "react";
import {ConsoleProvider, useConsole} from "@/components/console/ConsoleContext";

// The sidebar merges the Shade Console's panes (Home/chat, Activity,
// Approvals, System, Memory, Traces, Cron, Config) with the app's content
// pages. All console routes share one vm via ConsoleProvider, so chat and
// agent state survive navigation.
const SidebarInner: React.FC = () => {
  const vm = useConsole();
  return (
    <SidebarNavigation
      topItems={[
        {label: "Home", route: "index", iconName: "comment"},
        {label: "Activity", route: "activity", iconName: "wave-square"},
        {
          label: "Approvals",
          route: "approvals",
          iconName: "shield-halved",
          badge: vm.pendingApprovalCount > 0 ? vm.pendingApprovalCount : undefined,
        },
        {label: "System", route: "system", iconName: "server"},
        {label: "Memory", route: "memory", iconName: "database"},
        {label: "Traces", route: "traces", iconName: "route"},
        {label: "Cron", route: "cron", iconName: "clock"},
        {label: "Search", route: "search", iconName: "magnifying-glass"},
        {label: "Movies", route: "movies", iconName: "film"},
        {label: "Features", route: "features", iconName: "list-check"},
        {label: "Reminders", route: "reminders", iconName: "circle-check"},
        {label: "Calendar", route: "calendars", iconName: "calendar"},
      ]}
      bottomItems={[
        {label: "Config", route: "config", iconName: "sliders"},
        {label: "Admin", route: "admin", iconName: "gear"},
        {label: "Profile", route: "profile", iconName: "user"},
      ]}
    >
      <SidebarNavigation.Screen name="index" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="activity" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="approvals" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="system" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="memory" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="traces" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="cron" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="config" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="search" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="features" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="profile" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="movies" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="reminders" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="calendars" options={{headerShown: false}} />
      <SidebarNavigation.Screen name="admin" options={{headerShown: false}} />
    </SidebarNavigation>
  );
};

const SidebarLayout: React.FC = () => (
  <ConsoleProvider>
    <SidebarInner />
  </ConsoleProvider>
);

// Expo Router requires default export for route files
export default SidebarLayout;
