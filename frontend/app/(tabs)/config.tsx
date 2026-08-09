import type React from "react";
import {useConsole} from "@/components/console/ConsoleContext";
import {ConsoleScreen} from "@/components/console/ConsoleScreen";
import {ConfigPane} from "@/components/console/panes";

const Screen: React.FC = () => {
  const vm = useConsole();
  return (
    <ConsoleScreen testID="console-config-screen">
      <ConfigPane vm={vm} />
    </ConsoleScreen>
  );
};

// Expo Router requires default export for route files
export default Screen;
