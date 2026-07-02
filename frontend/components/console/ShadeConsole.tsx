// Shade Console — a personal agent console.
//
// Top-level composition of the imported "Shade Console" design: a macOS-style
// titlebar, a selectable shell (cursor / rail / tabs), the chat column, the
// eight main panes, the agent drawer, and the floating alerts / demo / toast
// layers. All state lives in useShadeConsole.

import type React from "react";
import {Pressable, View} from "react-native";
import {radius, v} from "@/constants/consoleTokens";
import {type ShellMode, useShadeConsole} from "@/hooks/useShadeConsole";
import {Chat} from "./Chat";
import {AgentDrawer, AlertsPopover, DemoModal, Toasts} from "./overlays";
import {
  ActivityPane,
  ApprovalsPane,
  AutomationsPane,
  ConfigPane,
  FeaturesPane,
  MemoryPane,
  SystemPane,
  TracesPane,
} from "./panes";
import {Dot, Hd, Icon, Txt} from "./primitives";

type Dict = Record<string, any>;
type VM = ReturnType<typeof useShadeConsole>;

const TrafficLights: React.FC = () => (
  <View style={{flexDirection: "row", gap: 8, alignItems: "center"}}>
    {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
      <View
        key={c}
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: c,
          borderWidth: 1,
          borderColor: "rgba(0,0,0,0.08)",
        }}
      />
    ))}
  </View>
);

const Titlebar: React.FC<{vm: VM}> = ({vm}) => (
  <View
    style={{
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      height: 44,
      paddingHorizontal: 14,
      backgroundColor: v("var(--surface-base)"),
      borderBottomWidth: 1,
      borderBottomColor: v("var(--border-default)"),
    }}
  >
    <TrafficLights />
    <View style={{flexDirection: "row", alignItems: "center", gap: 8}}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: v("var(--secondary-700)"),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Hd style={{color: v("var(--accent-300)"), fontSize: 12}}>S</Hd>
      </View>
      <Hd style={{fontSize: 14}}>Shade</Hd>
      <Txt style={{fontSize: 11, color: v("var(--text-extra-light)")}}>personal agent console</Txt>
    </View>
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 3,
          paddingHorizontal: 10,
          borderRadius: radius.rounded,
          backgroundColor: v("var(--surface-success-light)"),
          borderWidth: 1,
          borderColor: v("var(--border-success)"),
        }}
      >
        <Dot color="var(--success-100)" size={7} />
        <Txt style={{fontSize: 11, color: v("var(--text-success)"), fontWeight: "700"}}>
          Sandboxed · Docker
        </Txt>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 3,
          paddingHorizontal: 10,
          borderRadius: radius.rounded,
          backgroundColor: v("var(--neutral-050)"),
          borderWidth: 1,
          borderColor: v("var(--border-default)"),
        }}
      >
        <Txt style={{fontSize: 11, color: v("var(--text-secondary-light)")}}>
          Egress: allowlist · <Txt style={{fontWeight: "700"}}>{vm.egressCount}</Txt> hosts
        </Txt>
      </View>
      <Pressable
        onPress={vm.toggleOffline}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 3,
          paddingHorizontal: 10,
          borderRadius: radius.rounded,
          backgroundColor: v(vm.offlineBg),
          borderWidth: 1,
          borderColor: v("var(--border-default)"),
        }}
      >
        <Dot color={vm.offline ? "var(--warning-100)" : "var(--status-active)"} size={7} />
        <Txt style={{fontSize: 11, color: v("var(--text-secondary-dark)"), fontWeight: "600"}}>
          {vm.offline ? "Offline — local models only" : "Online"}
        </Txt>
      </Pressable>
    </View>
    <View style={{flexDirection: "row", alignItems: "center", gap: 10}}>
      <Pressable
        testID="console-alerts-button"
        onPress={vm.toggleAlerts}
        style={{
          width: 30,
          height: 30,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: v("var(--border-default)"),
          backgroundColor: v("var(--surface-base)"),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon
          d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15z M10 21h4"
          color="var(--text-secondary-dark)"
          size={17}
        />
        {vm.hasUnreadAlerts ? (
          <View
            style={{
              position: "absolute",
              top: -5,
              right: -5,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: v("var(--error-100)"),
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 4,
            }}
          >
            <Txt style={{color: v("var(--text-inverted)"), fontSize: 10, fontWeight: "700"}}>
              {vm.unreadCount}
            </Txt>
          </View>
        ) : null}
      </Pressable>
      {vm.notKilled ? (
        <Pressable
          testID="console-kill-button"
          onPress={vm.onKill}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 5,
            paddingHorizontal: 12,
            borderRadius: radius.rounded,
            backgroundColor: v(vm.killBg),
            borderWidth: 1,
            borderColor: v("var(--border-error)"),
          }}
        >
          <Icon
            d="M12 3v8 M6.3 6.3a8 8 0 1 0 11.4 0"
            color={vm.killFg}
            size={13}
            strokeWidth={2.2}
          />
          <Txt style={{color: v(vm.killFg), fontWeight: "700", fontSize: 12}}>{vm.killLabel}</Txt>
        </Pressable>
      ) : (
        <Pressable
          testID="console-restore-button"
          onPress={vm.onRestore}
          style={{
            paddingVertical: 5,
            paddingHorizontal: 12,
            borderRadius: radius.rounded,
            backgroundColor: v("var(--surface-secondary-dark)"),
          }}
        >
          <Txt style={{color: v("var(--text-inverted)"), fontWeight: "700", fontSize: 12}}>
            Restore agents
          </Txt>
        </Pressable>
      )}
    </View>
  </View>
);

const NavBadge: React.FC<{n: number}> = ({n}) => (
  <View
    style={{
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: v("var(--error-100)"),
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 4,
    }}
  >
    <Txt style={{color: v("var(--text-inverted)"), fontSize: 10, fontWeight: "700"}}>{n}</Txt>
  </View>
);

const TopTabs: React.FC<{vm: VM}> = ({vm}) => (
  <View
    style={{
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingVertical: 6,
      paddingHorizontal: 16,
      backgroundColor: v("var(--surface-base)"),
      borderBottomWidth: 1,
      borderBottomColor: v("var(--border-default)"),
    }}
  >
    {vm.navItems.map((n: Dict) => (
      <Pressable
        key={n.id}
        onPress={n.onClick}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          paddingVertical: 6,
          paddingHorizontal: 13,
          borderRadius: radius.rounded,
          backgroundColor: v(n.bg),
        }}
      >
        <Icon d={n.d} color={n.fg} size={15} />
        <Txt style={{color: v(n.fg), fontSize: 12.5, fontWeight: "600"}}>{n.label}</Txt>
        {n.showBadge ? <NavBadge n={n.badge} /> : null}
      </Pressable>
    ))}
  </View>
);

const IconRail: React.FC<{vm: VM}> = ({vm}) => (
  <View
    style={{
      width: 68,
      backgroundColor: v("var(--surface-secondary-extra-dark)"),
      alignItems: "center",
      paddingVertical: 10,
      gap: 2,
    }}
  >
    {vm.navItems.map((n: Dict) => (
      <Pressable
        key={n.id}
        onPress={n.onClick}
        style={{
          width: 56,
          alignItems: "center",
          gap: 3,
          paddingTop: 8,
          paddingBottom: 6,
          borderRadius: radius.md,
          backgroundColor: v(n.railBg),
        }}
      >
        <Icon d={n.d} color={n.railFg} size={18} />
        <Txt style={{color: v(n.railFg), fontSize: 9, fontWeight: "600"}}>{n.label}</Txt>
        {n.showBadge ? (
          <View style={{position: "absolute", top: 3, right: 7}}>
            <NavBadge n={n.badge} />
          </View>
        ) : null}
      </Pressable>
    ))}
  </View>
);

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

const MainPane: React.FC<{vm: VM}> = ({vm}) => (
  <View style={{position: "relative", flex: 1, minWidth: 0, minHeight: 0}}>
    {vm.paneFeatures ? <FeaturesPane vm={vm} /> : null}
    {vm.paneSystem ? <SystemPane vm={vm} /> : null}
    {vm.paneActivity ? <ActivityPane vm={vm} /> : null}
    {vm.paneApprovals ? <ApprovalsPane vm={vm} /> : null}
    {vm.paneMemory ? <MemoryPane vm={vm} /> : null}
    {vm.paneTraces ? <TracesPane vm={vm} /> : null}
    {vm.paneAuto ? <AutomationsPane vm={vm} /> : null}
    {vm.paneConfig ? <ConfigPane vm={vm} /> : null}
    <AgentDrawer vm={vm} />
  </View>
);

interface ShadeConsoleProps {
  shell?: ShellMode;
}

export const ShadeConsole: React.FC<ShadeConsoleProps> = ({shell = "cursor"}) => {
  const vm = useShadeConsole(shell);
  return (
    <View testID="console-screen" style={{flex: 1, backgroundColor: v("var(--neutral-050)")}}>
      <Titlebar vm={vm} />
      {vm.isTabs ? <TopTabs vm={vm} /> : null}
      {vm.killed ? <KillBanner /> : null}
      <View style={{flex: 1, flexDirection: "row", minHeight: 0}}>
        {vm.showRail ? <IconRail vm={vm} /> : null}
        {vm.showChat ? <Chat vm={vm} /> : null}
        {vm.showMain ? <MainPane vm={vm} /> : null}
      </View>
      <AlertsPopover vm={vm} />
      <DemoModal vm={vm} />
      <Toasts vm={vm} />
    </View>
  );
};
