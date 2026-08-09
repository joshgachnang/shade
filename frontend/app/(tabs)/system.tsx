import type React from "react";
import {useConsole} from "@/components/console/ConsoleContext";
import {ConsoleScreen} from "@/components/console/ConsoleScreen";
import {SystemPane} from "@/components/console/panes";

const Screen: React.FC = () => {
  const vm = useConsole();
  return (
    <ConsoleScreen testID="console-system-screen">
      <SystemPane vm={vm} />
    </ConsoleScreen>
  );
};

// Expo Router requires default export for route files
export default Screen;
