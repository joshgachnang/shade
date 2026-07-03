// Floating layers over the Shade Console: the agent detail drawer, the alert
// inbox popover, the demo modal, and the toast stack.

import type React from "react";
import {Pressable, ScrollView, View} from "react-native";
import {radius, shadowFloating, v} from "@/constants/consoleTokens";
import type {ConsoleVM} from "@/hooks/useShadeConsole";
import {Dot, Hd, Mono, Pill, SectionLabel, Txt} from "./primitives";

type Dict = Record<string, any>;

// --- Agent drawer -----------------------------------------------------------
export const AgentDrawer: React.FC<{vm: ConsoleVM}> = ({vm}) => {
  if (!vm.hasAgentSel) {
    return null;
  }
  return (
    <View
      testID="console-agent-drawer"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        backgroundColor: v("var(--surface-base)"),
        borderLeftWidth: 1,
        borderLeftColor: v("var(--border-default)"),
        ...shadowFloating,
        zIndex: 30,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 9,
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: v("var(--border-default)"),
        }}
      >
        <Dot color={vm.agDot} size={9} />
        <Hd style={{fontSize: 15}}>{vm.agName}</Hd>
        <Txt style={{fontSize: 11, color: v("var(--text-extra-light)")}}>{vm.agKind}</Txt>
        <Pressable onPress={vm.onCloseDrawer} style={{marginLeft: "auto"}}>
          <Txt style={{color: v("var(--text-extra-light)"), fontSize: 17}}>×</Txt>
        </Pressable>
      </View>
      <ScrollView
        style={{flex: 1}}
        contentContainerStyle={{paddingVertical: 14, paddingHorizontal: 16}}
      >
        <View style={{flexDirection: "row", flexWrap: "wrap", gap: 6}}>
          <Pill
            label={String(vm.agSandbox)}
            bg="var(--surface-success-light)"
            fg="var(--text-success)"
            border="var(--border-success)"
            fontSize={10.5}
            bold={false}
          />
          <Pill
            label={String(vm.agHost)}
            bg="var(--neutral-050)"
            fg="var(--text-secondary-light)"
            border="var(--border-default)"
            fontSize={10.5}
            bold={false}
          />
          <Pill
            label={`heartbeat ${vm.agBeat}`}
            bg="var(--neutral-050)"
            fg="var(--text-secondary-light)"
            border="var(--border-default)"
            fontSize={10.5}
            bold={false}
          />
        </View>
        <SectionLabel style={{marginTop: 16, marginBottom: 7}}>
          Tool scopes — least privilege
        </SectionLabel>
        <View style={{gap: 5}}>
          {vm.agScopes.map((sc: Dict, i: number) => (
            <Pressable
              key={i}
              onPress={sc.onToggle}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 9,
                paddingVertical: 7,
                paddingHorizontal: 11,
                borderWidth: 1,
                borderColor: v(sc.bd),
                borderRadius: radius.md,
                backgroundColor: v(sc.bg),
              }}
            >
              <View
                style={{
                  width: 15,
                  height: 15,
                  borderRadius: radius.sm,
                  borderWidth: 1.5,
                  borderColor: v(sc.boxBd),
                  backgroundColor: v(sc.boxBg),
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Txt style={{color: "#fff", fontSize: 10}}>{sc.mark}</Txt>
              </View>
              <Txt
                style={{fontSize: 12, fontWeight: "600", color: v("var(--text-secondary-dark)")}}
              >
                {sc.label}
              </Txt>
              <Txt style={{marginLeft: "auto", fontSize: 10, color: v("var(--text-extra-light)")}}>
                {sc.note}
              </Txt>
            </Pressable>
          ))}
        </View>
        <SectionLabel style={{marginTop: 16, marginBottom: 7}}>
          Egress — allowed destinations
        </SectionLabel>
        <View style={{flexDirection: "row", flexWrap: "wrap", gap: 5}}>
          {vm.agEgress.length ? (
            vm.agEgress.map((ae: Dict, i: number) => (
              <View
                key={i}
                style={{
                  paddingVertical: 2,
                  paddingHorizontal: 9,
                  borderRadius: radius.rounded,
                  backgroundColor: v("var(--neutral-050)"),
                  borderWidth: 1,
                  borderColor: v("var(--border-default)"),
                }}
              >
                <Mono style={{fontSize: 10.5, color: v("var(--text-secondary-dark)")}}>
                  {ae.host}
                </Mono>
              </View>
            ))
          ) : (
            <Txt style={{fontSize: 10.5, color: v("var(--text-extra-light)")}}>
              none — fully local
            </Txt>
          )}
        </View>
        <SectionLabel style={{marginTop: 16, marginBottom: 7}}>Recent egress</SectionLabel>
        <View
          style={{
            borderWidth: 1,
            borderColor: v("var(--border-default)"),
            borderRadius: radius.md,
            overflow: "hidden",
          }}
        >
          {vm.agLog.length ? (
            vm.agLog.map((al: Dict, i: number) => (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 6,
                  paddingHorizontal: 11,
                  borderBottomWidth: 1,
                  borderBottomColor: v("var(--neutral-050)"),
                }}
              >
                <Mono style={{fontSize: 10, color: v("var(--text-extra-light)"), width: 48}}>
                  {al.time}
                </Mono>
                <Mono style={{color: v("var(--text-secondary-dark)"), flex: 1}}>{al.dest}</Mono>
                <Txt style={{fontSize: 10, fontWeight: "700", color: v(al.fg)}}>{al.verdict}</Txt>
              </View>
            ))
          ) : (
            <Txt style={{fontSize: 10.5, color: v("var(--text-extra-light)"), padding: 11}}>
              no egress recorded
            </Txt>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

// --- Alerts popover ---------------------------------------------------------
export const AlertsPopover: React.FC<{vm: ConsoleVM}> = ({vm}) => {
  if (!vm.alertsOpen) {
    return null;
  }
  return (
    <View
      testID="console-alerts-popover"
      style={{
        position: "absolute",
        top: 48,
        right: 64,
        width: 340,
        backgroundColor: v("var(--surface-base)"),
        borderWidth: 1,
        borderColor: v("var(--border-default)"),
        borderRadius: radius.md,
        ...shadowFloating,
        zIndex: 60,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderBottomWidth: 1,
          borderBottomColor: v("var(--border-default)"),
        }}
      >
        <Hd style={{fontSize: 13.5}}>Alerts</Hd>
        <Pressable onPress={vm.onMarkAllRead} style={{marginLeft: "auto"}}>
          <Txt style={{color: v("var(--text-link)"), fontSize: 11, fontWeight: "700"}}>
            Mark all read
          </Txt>
        </Pressable>
      </View>
      {vm.alertRows.map((al: Dict) => (
        <View
          key={al.id}
          style={{
            flexDirection: "row",
            gap: 9,
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderBottomWidth: 1,
            borderBottomColor: v("var(--neutral-050)"),
            backgroundColor: v(al.bg),
          }}
        >
          <View style={{marginTop: 5}}>
            <Dot color={al.dot} size={7} />
          </View>
          <View style={{flex: 1}}>
            <Txt style={{fontSize: 12, fontWeight: "600", color: v("var(--text-primary)")}}>
              {al.title}
            </Txt>
            <Txt style={{fontSize: 10.5, color: v("var(--text-extra-light)"), marginTop: 2}}>
              {al.time}
            </Txt>
          </View>
        </View>
      ))}
    </View>
  );
};

// --- Demo modal -------------------------------------------------------------
export const DemoModal: React.FC<{vm: ConsoleVM}> = ({vm}) => {
  if (!vm.showDemo) {
    return null;
  }
  return (
    <Pressable
      testID="console-demo-modal"
      onPress={vm.onCloseDemo}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(4,30,39,0.45)",
        zIndex: 80,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Pressable
        onPress={() => {}}
        style={{
          width: 720,
          maxWidth: "90%",
          backgroundColor: v("var(--surface-base)"),
          borderRadius: radius.md,
          ...shadowFloating,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 10,
            paddingHorizontal: 14,
            backgroundColor: v("var(--neutral-050)"),
            borderBottomWidth: 1,
            borderBottomColor: v("var(--border-default)"),
          }}
        >
          <View style={{flexDirection: "row", gap: 6}}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: v("var(--neutral-300)"),
                }}
              />
            ))}
          </View>
          <View
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: v("var(--border-default)"),
              borderRadius: radius.rounded,
              paddingVertical: 3,
              paddingHorizontal: 14,
              backgroundColor: v("var(--surface-base)"),
            }}
          >
            <Mono
              style={{textAlign: "center", fontSize: 11.5, color: v("var(--text-secondary-light)")}}
            >
              {vm.demoUrl}
            </Mono>
          </View>
          <Pressable onPress={vm.onCloseDemo}>
            <Txt style={{color: v("var(--text-extra-light)"), fontSize: 16}}>×</Txt>
          </Pressable>
        </View>
        <View
          style={{
            height: 380,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            backgroundColor: v("var(--neutral-050)"),
          }}
        >
          <Hd style={{fontSize: 18}}>{vm.demoName} — live demo</Hd>
          <Txt
            style={{
              fontSize: 12,
              color: v("var(--text-secondary-light)"),
              maxWidth: 380,
              textAlign: "center",
            }}
          >
            Shade deploys each feature build here as soon as the first cut compiles. Reload anytime
            — it tracks the feature branch.
          </Txt>
          <Pill
            label={String(vm.demoStatus)}
            bg="var(--surface-success-light)"
            fg="var(--text-success)"
            border="var(--border-success)"
            fontSize={11}
            bold={false}
          />
        </View>
      </Pressable>
    </Pressable>
  );
};

// --- Toasts -----------------------------------------------------------------
export const Toasts: React.FC<{vm: ConsoleVM}> = ({vm}) => (
  <View style={{position: "absolute", right: 18, bottom: 18, gap: 10, zIndex: 90, width: 340}}>
    {vm.toastRows.map((t: Dict) => (
      <View
        key={t.id}
        style={{
          backgroundColor: v("var(--surface-base)"),
          borderWidth: 1,
          borderColor: v("var(--border-default)"),
          borderLeftWidth: 4,
          borderLeftColor: v(t.accent),
          borderRadius: radius.md,
          ...shadowFloating,
          paddingVertical: 11,
          paddingHorizontal: 14,
        }}
      >
        <View style={{flexDirection: "row", alignItems: "center", gap: 8}}>
          <Txt style={{fontWeight: "700", fontSize: 12.5, color: v("var(--text-secondary-dark)")}}>
            {t.title}
          </Txt>
          <Pressable onPress={t.onDismiss} style={{marginLeft: "auto"}}>
            <Txt style={{color: v("var(--text-extra-light)"), fontSize: 14}}>×</Txt>
          </Pressable>
        </View>
        <Txt
          style={{
            fontSize: 11.5,
            color: v("var(--text-secondary-light)"),
            marginTop: 3,
            lineHeight: 16,
          }}
        >
          {t.body}
        </Txt>
        {t.isApproval ? (
          <View style={{flexDirection: "row", gap: 7, marginTop: 9}}>
            <Pressable
              onPress={t.onApprove}
              style={{
                paddingVertical: 4,
                paddingHorizontal: 13,
                borderRadius: radius.rounded,
                backgroundColor: v("var(--surface-success)"),
              }}
            >
              <Txt style={{color: v("var(--text-inverted)"), fontWeight: "700", fontSize: 11}}>
                Approve
              </Txt>
            </Pressable>
            <Pressable
              onPress={t.onDeny}
              style={{
                paddingVertical: 4,
                paddingHorizontal: 13,
                borderRadius: radius.rounded,
                borderWidth: 1,
                borderColor: v("var(--border-error)"),
                backgroundColor: v("var(--surface-base)"),
              }}
            >
              <Txt style={{color: v("var(--text-error)"), fontWeight: "700", fontSize: 11}}>
                Deny
              </Txt>
            </Pressable>
            <Pressable
              onPress={t.onReview}
              style={{
                paddingVertical: 4,
                paddingHorizontal: 13,
                borderRadius: radius.rounded,
                borderWidth: 1,
                borderColor: v("var(--border-default)"),
                backgroundColor: v("var(--surface-base)"),
              }}
            >
              <Txt
                style={{color: v("var(--text-secondary-dark)"), fontWeight: "600", fontSize: 11}}
              >
                Review →
              </Txt>
            </Pressable>
          </View>
        ) : null}
      </View>
    ))}
  </View>
);
