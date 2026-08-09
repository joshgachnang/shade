// Shared chrome for console routes: a status bar built from @terreno/ui
// components (badges, buttons), the kill-switch banner, and the floating
// overlay layers (agent drawer, alerts popover, demo modal, toasts). Each
// sidebar route wraps its pane in <ConsoleScreen>.

import {Badge, Box, Button, IconButton} from "@terreno/ui";
import type React from "react";
import {View} from "react-native";
import {v} from "@/constants/consoleTokens";
import {useConsole} from "./ConsoleContext";
import {AgentDrawer, AlertsPopover, DemoModal, Toasts} from "./overlays";
import {Icon, Txt} from "./primitives";

const StatusBar: React.FC = () => {
  const vm = useConsole();
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: v("var(--border-default)"),
        backgroundColor: v("var(--surface-base)"),
      }}
    >
      <Box direction="row" alignItems="center" justifyContent="between" padding={2} gap={2} wrap>
        <Box direction="row" alignItems="center" gap={2} wrap flex="shrink">
          <Badge status="success" value="Sandboxed · Docker" />
          <Badge status="neutral" value={`Egress allowlist · ${vm.egressCount} hosts`} />
          <Badge
            testID="console-online-badge"
            status={vm.offline ? "warning" : "info"}
            value={vm.offline ? "Offline — local models only" : "Online"}
          />
          <Button
            testID="console-offline-toggle"
            text={vm.offline ? "Go online" : "Go offline"}
            variant="ghost"
            onClick={vm.toggleOffline}
          />
        </Box>
        <Box direction="row" alignItems="center" gap={2}>
          <IconButton
            testID="console-alerts-button"
            accessibilityLabel="Alerts"
            iconName="bell"
            variant="muted"
            indicator={vm.hasUnreadAlerts ? "error" : undefined}
            indicatorText={vm.hasUnreadAlerts ? vm.unreadCount : undefined}
            onClick={vm.toggleAlerts}
          />
          {vm.notKilled ? (
            <Button
              testID="console-kill-button"
              text={vm.killLabel}
              variant="destructive"
              onClick={vm.onKill}
            />
          ) : (
            <Button
              testID="console-restore-button"
              text="Restore agents"
              variant="secondary"
              onClick={vm.onRestore}
            />
          )}
        </Box>
      </Box>
    </View>
  );
};

const KillBanner: React.FC = () => (
  <View
    style={{
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 8,
      paddingHorizontal: 18,
      backgroundColor: v("var(--surface-error)"),
    }}
  >
    <Icon
      d="M12 3v8 M6.3 6.3a8 8 0 1 0 11.4 0"
      color="var(--text-inverted)"
      size={14}
      strokeWidth={2.2}
    />
    <Txt style={{color: v("var(--text-inverted)"), fontWeight: "700", fontSize: 12.5}}>
      Kill switch engaged — all agents halted, queued actions frozen. Nothing runs until you
      restore.
    </Txt>
  </View>
);

interface ConsoleScreenProps {
  testID: string;
  children: React.ReactNode;
}

export const ConsoleScreen: React.FC<ConsoleScreenProps> = ({testID, children}) => {
  const vm = useConsole();
  return (
    <View testID={testID} style={{flex: 1, minHeight: 0, backgroundColor: v("var(--neutral-050)")}}>
      <StatusBar />
      {vm.killed ? <KillBanner /> : null}
      <View style={{position: "relative", flex: 1, minWidth: 0, minHeight: 0}}>
        {children}
        <AgentDrawer vm={vm} />
      </View>
      <AlertsPopover vm={vm} />
      <DemoModal vm={vm} />
      <Toasts vm={vm} />
    </View>
  );
};
