import type React from "react";
import {useConsole} from "@/components/console/ConsoleContext";
import {ConsoleScreen} from "@/components/console/ConsoleScreen";
import {ActivityPane} from "@/components/console/panes";

const Screen: React.FC = () => {
  const vm = useConsole();
  return (
    <ConsoleScreen testID="console-activity-screen">
      <ActivityPane vm={vm} />
    </ConsoleScreen>
  );
};

// Expo Router requires default export for route files
export default Screen;
