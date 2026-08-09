import type React from "react";
import {createContext, useContext} from "react";
import {type ConsoleVM, useShadeConsole} from "@/hooks/useShadeConsole";

// One console view-model shared across every route so chat history, agents,
// approvals, and toasts survive sidebar navigation. Mounted in the (tabs)
// layout; individual screens render their pane from this context.
const ConsoleContext = createContext<ConsoleVM | null>(null);

export const ConsoleProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  // "rail" shell semantics give the chat column flex sizing (no fixed width);
  // the console's own rail/tab navigation is replaced by the app sidebar.
  const vm = useShadeConsole("rail");
  return <ConsoleContext.Provider value={vm}>{children}</ConsoleContext.Provider>;
};

export const useConsole = (): ConsoleVM => {
  const vm = useContext(ConsoleContext);
  if (!vm) {
    throw new Error("useConsole must be used within ConsoleProvider");
  }
  return vm;
};
