import type React from "react";
import {Chat} from "@/components/console/Chat";
import {useConsole} from "@/components/console/ConsoleContext";
import {ConsoleScreen} from "@/components/console/ConsoleScreen";

// The Shade Console chat is the home page; the console's panes live as their
// own sidebar routes (Activity, Approvals, System, …) sharing the same vm.
const HomeScreen: React.FC = () => {
  const vm = useConsole();
  return (
    <ConsoleScreen testID="home-screen">
      <Chat vm={vm} />
    </ConsoleScreen>
  );
};

// Expo Router requires default export for route files
export default HomeScreen;
