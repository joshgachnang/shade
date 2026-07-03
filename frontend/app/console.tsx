import {useLocalSearchParams} from "expo-router";
import type React from "react";
import {ShadeConsole} from "@/components/console/ShadeConsole";
import type {ShellMode} from "@/hooks/useShadeConsole";

const SHELLS: ShellMode[] = ["cursor", "rail", "tabs"];

/**
 * Full-screen Shade Console route. The shell layout (cursor / rail / tabs) can
 * be chosen with `?shell=rail`; it defaults to the Cursor-style split.
 */
const ConsoleScreen: React.FC = () => {
  const {shell} = useLocalSearchParams<{shell?: string}>();
  const mode: ShellMode = SHELLS.includes(shell as ShellMode) ? (shell as ShellMode) : "cursor";
  return <ShadeConsole shell={mode} />;
};

// Expo Router requires default export for route files
export default ConsoleScreen;
