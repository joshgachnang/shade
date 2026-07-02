// The eight main panes of the Shade Console: Features, System Map, Activity,
// Approvals, Memory, Traces, Automations, Config. Each reads the view-model
// produced by useShadeConsole and renders a close translation of the design.

import type React from "react";
import {Pressable, ScrollView, TextInput, View} from "react-native";
import {fonts, radius, shadowCard, v} from "@/constants/consoleTokens";
import type {ConsoleVM} from "@/hooks/useShadeConsole";
import {
  Dot,
  Hd,
  Icon,
  LiveDot,
  Mono,
  Pill,
  ProgressBar,
  SAvatar,
  SectionLabel,
  Select,
  Txt,
} from "./primitives";

type Dict = Record<string, any>;

const PaneScroll: React.FC<{children: React.ReactNode; testID: string}> = ({children, testID}) => (
  <ScrollView
    testID={testID}
    style={{flex: 1}}
    contentContainerStyle={{paddingVertical: 20, paddingHorizontal: 24}}
  >
    {children}
  </ScrollView>
);

const PaneHeader: React.FC<{title: string; sub?: string; right?: React.ReactNode}> = ({
  title,
  sub,
  right,
}) => (
  <View style={{flexDirection: "row", alignItems: "baseline", gap: 10}}>
    <Hd style={{fontSize: 18}}>{title}</Hd>
    {sub ? (
      <Txt style={{fontSize: 12, color: v("var(--text-extra-light)"), flexShrink: 1}}>{sub}</Txt>
    ) : null}
    {right ? <View style={{marginLeft: "auto"}}>{right}</View> : null}
  </View>
);

const card = {
  borderWidth: 1,
  borderColor: v("var(--border-default)"),
  borderRadius: radius.md,
  backgroundColor: v("var(--surface-base)"),
} as const;

const liveBadge = (vm: ConsoleVM) => (
  <View style={{flexDirection: "row", alignItems: "center", gap: 6}}>
    <LiveDot color={vm.liveDot} size={8} />
    <Txt style={{fontSize: 11, fontWeight: "700", color: v(vm.liveFg)}}>{vm.liveLabel}</Txt>
  </View>
);

// --- Features ---------------------------------------------------------------
export const FeaturesPane: React.FC<{vm: ConsoleVM}> = ({vm}) => (
  <PaneScroll testID="console-pane-features">
    <PaneHeader
      title="Features"
      sub="prototypes Shade is building — each gets a demo link as soon as there's something to click"
    />
    <View style={{flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 14}}>
      {vm.featureCards.map((f: Dict) => (
        <View
          key={f.id}
          style={{...card, ...shadowCard, width: 340, minWidth: 300, flexGrow: 1, maxWidth: 460}}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingTop: 12,
              paddingHorizontal: 14,
              paddingBottom: 8,
            }}
          >
            <Hd style={{fontSize: 14.5}}>{f.name}</Hd>
            <View
              style={{
                paddingVertical: 2,
                paddingHorizontal: 8,
                borderRadius: radius.rounded,
                backgroundColor: v(f.badgeBg),
              }}
            >
              <Txt style={{fontSize: 10, fontWeight: "700", color: v(f.badgeFg)}}>
                {f.statusLabel}
              </Txt>
            </View>
            <Txt
              style={{
                marginLeft: "auto",
                fontSize: 11.5,
                fontWeight: "700",
                color: v("var(--text-secondary-dark)"),
              }}
            >
              {f.pct}%
            </Txt>
          </View>
          <View style={{paddingHorizontal: 14}}>
            <Txt style={{fontSize: 12, color: v("var(--text-secondary-light)"), lineHeight: 17}}>
              {f.desc}
            </Txt>
          </View>
          <View style={{marginHorizontal: 14, marginTop: 10}}>
            <ProgressBar pct={f.pct} />
          </View>
          <View style={{gap: 5, paddingVertical: 10, paddingHorizontal: 14}}>
            {f.steps.map((st: Dict) => (
              <View key={st.key} style={{flexDirection: "row", alignItems: "center", gap: 8}}>
                {st.isDone ? (
                  <View
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 7,
                      backgroundColor: v("var(--success-100)"),
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Txt style={{color: "#fff", fontSize: 8}}>✓</Txt>
                  </View>
                ) : st.isProg ? (
                  <View
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 7,
                      borderWidth: 2,
                      borderColor: v("var(--primary-400)"),
                      borderTopColor: "transparent",
                    }}
                  />
                ) : st.isErr ? (
                  <View
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 7,
                      backgroundColor: v("var(--error-100)"),
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Txt style={{color: "#fff", fontSize: 8}}>!</Txt>
                  </View>
                ) : (
                  <View
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 7,
                      borderWidth: 1.5,
                      borderColor: v("var(--border-default)"),
                    }}
                  />
                )}
                <Txt style={{fontSize: 11.5, color: v(st.fg)}}>{st.name}</Txt>
              </View>
            ))}
          </View>
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderTopWidth: 1,
              borderTopColor: v("var(--neutral-050)"),
            }}
          >
            {f.hasDemo ? (
              <Pressable
                onPress={f.onDemo}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  paddingVertical: 4,
                  paddingHorizontal: 12,
                  borderRadius: radius.rounded,
                  borderWidth: 1,
                  borderColor: v("var(--primary-300)"),
                  backgroundColor: v("var(--primary-000)"),
                }}
              >
                <Txt style={{color: v("var(--text-link)"), fontWeight: "700", fontSize: 11.5}}>
                  ▶ {f.demoUrl}
                </Txt>
              </Pressable>
            ) : (
              <Txt style={{fontSize: 11, color: v("var(--text-extra-light)"), paddingVertical: 5}}>
                demo link appears at first deploy
              </Txt>
            )}
          </View>
        </View>
      ))}
    </View>
  </PaneScroll>
);

// --- System Map -------------------------------------------------------------
const FlowLines: React.FC<{color: string}> = ({color}) => (
  <View style={{gap: 26, paddingTop: 40}}>
    {[0, 1, 2].map((i) => (
      <View key={i} style={{height: 2, flexDirection: "row", overflow: "hidden"}}>
        {Array.from({length: 12}).map((_, j) => (
          <View
            key={j}
            style={{width: 10, height: 2, marginRight: 14, backgroundColor: v(color)}}
          />
        ))}
      </View>
    ))}
  </View>
);

export const SystemPane: React.FC<{vm: ConsoleVM}> = ({vm}) => (
  <PaneScroll testID="console-pane-system">
    <PaneHeader
      title="System map"
      sub="live — nodes pulse as events flow through them"
      right={liveBadge(vm)}
    />
    <View style={{flexDirection: "row", gap: 12, marginTop: 16, alignItems: "flex-start"}}>
      {/* channels */}
      <View style={{flex: 1, gap: 8}}>
        <SectionLabel>Channels in</SectionLabel>
        {vm.channels.map((c: Dict, i: number) => (
          <View
            key={i}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
              paddingVertical: 9,
              paddingHorizontal: 12,
              borderWidth: 1,
              borderColor: v(c.bd),
              borderRadius: radius.md,
              backgroundColor: v("var(--surface-base)"),
            }}
          >
            <Dot color={c.dot} size={8} />
            <View style={{minWidth: 0, flexShrink: 1}}>
              <Txt
                style={{fontWeight: "700", fontSize: 12.5, color: v("var(--text-secondary-dark)")}}
              >
                {c.name}
              </Txt>
              <Txt style={{fontSize: 10.5, color: v("var(--text-extra-light)")}}>{c.sub}</Txt>
            </View>
            {c.privileged ? (
              <View style={{marginLeft: "auto"}}>
                <Pill
                  label="privileged"
                  bg="var(--accent-050)"
                  fg="var(--accent-800)"
                  border="var(--accent-500)"
                  fontSize={9.5}
                />
              </View>
            ) : null}
          </View>
        ))}
      </View>
      <FlowLines color="var(--primary-300)" />
      {/* orchestrator core */}
      <View style={{flex: 1.1, gap: 8}}>
        <SectionLabel>Core</SectionLabel>
        <View
          style={{
            borderWidth: 1.5,
            borderColor: v("var(--secondary-500)"),
            borderRadius: radius.md,
            backgroundColor: v("var(--secondary-000)"),
            padding: 14,
          }}
        >
          <View style={{flexDirection: "row", alignItems: "center", gap: 8}}>
            <SAvatar size={26} />
            <View>
              <Hd style={{fontSize: 13.5}}>Orchestrator</Hd>
              <Txt style={{fontSize: 10.5, color: v("var(--text-secondary-light)")}}>
                classify → route → spawn
              </Txt>
            </View>
          </View>
          <View style={{flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 9}}>
            {["classifier · qwen3-local", "approval gate", "memory"].map((t) => (
              <Pill
                key={t}
                label={t}
                bg="var(--surface-base)"
                fg="var(--text-secondary-light)"
                border="var(--border-default)"
                fontSize={10}
                bold={false}
              />
            ))}
          </View>
        </View>
        <View style={{...card, padding: 12}}>
          <SectionLabel style={{marginBottom: 7}}>Spawn graph — live runs</SectionLabel>
          {vm.spawnRoots.map((r: Dict, i: number) => (
            <View key={i} style={{marginBottom: 6}}>
              <View style={{flexDirection: "row", alignItems: "center", gap: 6}}>
                <Txt style={{color: v("var(--text-extra-light)")}}>●</Txt>
                <Txt
                  style={{fontSize: 12, fontWeight: "700", color: v("var(--text-secondary-dark)")}}
                >
                  {r.name}
                </Txt>
                <Mono style={{fontSize: 10.5, color: v("var(--text-extra-light)")}}>{r.runId}</Mono>
              </View>
              {r.children.map((ch: Dict, j: number) => (
                <View
                  key={j}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingLeft: 14,
                    borderLeftWidth: 1,
                    borderLeftColor: v("var(--border-default)"),
                    marginLeft: 4,
                    paddingTop: 3,
                  }}
                >
                  <Txt style={{fontSize: 11.5, color: v("var(--text-secondary-light)")}}>
                    └ {ch.name}
                  </Txt>
                  <Txt style={{fontSize: 10, color: v("var(--text-extra-light)")}}>{ch.time}</Txt>
                </View>
              ))}
            </View>
          ))}
        </View>
      </View>
      <FlowLines color="var(--secondary-300)" />
      {/* agents */}
      <View style={{flex: 1.3, gap: 8}}>
        <SectionLabel>Registered agents — tap for scopes</SectionLabel>
        {vm.agentsList.map((a: Dict) => (
          <Pressable
            key={a.id}
            onPress={a.onOpen}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderWidth: 1,
              borderColor: v(a.bd),
              borderRadius: radius.md,
              backgroundColor: v("var(--surface-base)"),
            }}
          >
            <Dot color={a.dot} size={8} />
            <View style={{minWidth: 0, flex: 1}}>
              <View style={{flexDirection: "row", alignItems: "center", gap: 6}}>
                <Txt
                  style={{
                    fontWeight: "700",
                    fontSize: 12.5,
                    color: v("var(--text-secondary-dark)"),
                  }}
                >
                  {a.name}
                </Txt>
                {a.edge ? (
                  <Pill
                    label="EDGE"
                    bg="var(--secondary-000)"
                    fg="var(--secondary-600)"
                    border="var(--secondary-100)"
                    fontSize={9}
                  />
                ) : null}
              </View>
              <Txt style={{fontSize: 10.5, color: v("var(--text-extra-light)")}}>{a.sub}</Txt>
            </View>
            <Txt style={{fontSize: 10, color: v("var(--text-extra-light)")}}>{a.scopeSummary}</Txt>
          </Pressable>
        ))}
      </View>
    </View>

    {/* cron strip */}
    <View style={{...card, marginTop: 18, padding: 14}}>
      <View style={{flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 9}}>
        <Icon
          d="M12 4.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15z M12 8.5V12l2.8 1.8"
          color="var(--secondary-500)"
          size={14}
        />
        <Hd style={{fontSize: 13}}>Cron & schedules — next up</Hd>
        <Pressable onPress={vm.goAutomations} style={{marginLeft: "auto"}}>
          <Txt style={{color: v("var(--text-link)"), fontSize: 11.5, fontWeight: "700"}}>
            manage in Automations →
          </Txt>
        </Pressable>
      </View>
      <View style={{flexDirection: "row", flexWrap: "wrap", gap: 8}}>
        {vm.cronNext.map((cr: Dict, i: number) => (
          <View
            key={i}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 11,
              borderWidth: 1,
              borderColor: v("var(--neutral-100)"),
              borderRadius: radius.md,
              backgroundColor: v("var(--neutral-050)"),
              minWidth: 170,
              flexGrow: 1,
            }}
          >
            <Txt style={{fontWeight: "700", fontSize: 12, color: v("var(--text-secondary-dark)")}}>
              {cr.name}
            </Txt>
            <Mono style={{fontSize: 10.5, color: v("var(--text-extra-light)"), marginTop: 2}}>
              {cr.sched}
            </Mono>
            <Txt
              style={{
                fontSize: 10.5,
                color: v("var(--text-link)"),
                fontWeight: "700",
                marginTop: 2,
              }}
            >
              {cr.next}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  </PaneScroll>
);

// --- Activity ---------------------------------------------------------------
export const ActivityPane: React.FC<{vm: ConsoleVM}> = ({vm}) => (
  <View testID="console-pane-activity" style={{flex: 1, minHeight: 0}}>
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingTop: 16,
        paddingHorizontal: 24,
        paddingBottom: 10,
      }}
    >
      <Hd style={{fontSize: 18}}>Activity</Hd>
      {liveBadge(vm)}
      <View style={{flex: 1}} />
      <Pressable
        onPress={vm.onPauseEngine}
        style={{
          paddingVertical: 5,
          paddingHorizontal: 13,
          borderRadius: radius.rounded,
          borderWidth: 1,
          borderColor: v("var(--border-active-neutral)"),
          backgroundColor: v(vm.pauseBg),
        }}
      >
        <Txt style={{color: v("var(--text-secondary-dark)"), fontWeight: "700", fontSize: 12}}>
          {vm.pauseLabel}
        </Txt>
      </Pressable>
      <Pressable
        onPress={vm.onIntervene}
        style={{
          paddingVertical: 5,
          paddingHorizontal: 13,
          borderRadius: radius.rounded,
          borderWidth: 1,
          borderColor: v("var(--border-warning)"),
          backgroundColor: v("var(--surface-warning-light)"),
        }}
      >
        <Txt style={{color: v("var(--text-warning)"), fontWeight: "700", fontSize: 12}}>
          ⚡ Intervene
        </Txt>
      </Pressable>
    </View>
    {vm.intervening ? (
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          marginHorizontal: 24,
          marginBottom: 10,
          padding: 10,
          borderWidth: 1,
          borderColor: v("var(--border-warning)"),
          borderRadius: radius.md,
          backgroundColor: v("var(--surface-warning-light)"),
        }}
      >
        <TextInput
          value={vm.interveneText}
          onChangeText={vm.onInterveneText}
          onSubmitEditing={vm.onInterveneSend}
          placeholder="Steer the running agents — e.g. “stop touching the backend, UI only”"
          placeholderTextColor={v("var(--text-extra-light)")}
          style={{
            flex: 1,
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderWidth: 1,
            borderColor: v("var(--border-default)"),
            borderRadius: radius.md,
            fontFamily: fonts.body,
            fontSize: 12.5,
            backgroundColor: v("var(--surface-base)"),
          }}
        />
        <Pressable
          onPress={vm.onInterveneSend}
          style={{
            paddingVertical: 6,
            paddingHorizontal: 14,
            borderRadius: radius.rounded,
            backgroundColor: v("var(--warning-100)"),
          }}
        >
          <Txt style={{color: v("var(--text-inverted)"), fontWeight: "700", fontSize: 12}}>
            Send to agents
          </Txt>
        </Pressable>
      </View>
    ) : null}
    <View
      style={{
        flexDirection: "row",
        gap: 6,
        paddingHorizontal: 24,
        paddingBottom: 10,
        flexWrap: "wrap",
      }}
    >
      {vm.actFilters.map((ft: Dict) => (
        <Pressable
          key={ft.id}
          onPress={ft.onClick}
          style={{
            paddingVertical: 3,
            paddingHorizontal: 11,
            borderRadius: radius.rounded,
            borderWidth: 1,
            borderColor: v(ft.bd),
            backgroundColor: v(ft.bg),
          }}
        >
          <Txt style={{fontSize: 11, fontWeight: "700", color: v(ft.fg)}}>{ft.label}</Txt>
        </Pressable>
      ))}
    </View>
    <ScrollView
      style={{flex: 1}}
      contentContainerStyle={{paddingHorizontal: 24, paddingBottom: 20}}
    >
      <View style={{...card, overflow: "hidden"}}>
        {vm.actRows.map((e: Dict) => (
          <View
            key={e.key}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingVertical: 7,
              paddingHorizontal: 14,
              borderBottomWidth: 1,
              borderBottomColor: v("var(--neutral-050)"),
            }}
          >
            <Mono style={{fontSize: 10.5, color: v("var(--text-extra-light)"), width: 56}}>
              {e.time}
            </Mono>
            <View
              style={{
                width: 76,
                borderRadius: radius.rounded,
                backgroundColor: v(e.kBg),
                paddingVertical: 2,
              }}
            >
              <Mono
                style={{color: v(e.kFg), fontSize: 9.5, fontWeight: "700", textAlign: "center"}}
              >
                {e.kindLabel}
              </Mono>
            </View>
            <Txt
              numberOfLines={1}
              style={{
                fontWeight: "700",
                color: v("var(--text-secondary-dark)"),
                width: 120,
                fontSize: 12,
              }}
            >
              {e.agent}
            </Txt>
            <Mono
              numberOfLines={1}
              style={{flex: 1, color: v("var(--text-primary)"), fontSize: 11.5}}
            >
              {e.text}
            </Mono>
            <Txt style={{fontSize: 10.5, color: v("var(--text-extra-light)")}}>{e.meta}</Txt>
          </View>
        ))}
      </View>
    </ScrollView>
  </View>
);

// --- Approvals --------------------------------------------------------------
export const ApprovalsPane: React.FC<{vm: ConsoleVM}> = ({vm}) => (
  <PaneScroll testID="console-pane-approvals">
    <PaneHeader
      title="Approval queue"
      sub="sensitive & critical actions hold here — nothing leaves the sandbox without you"
    />
    <View style={{gap: 10, marginTop: 14, maxWidth: 760}}>
      {vm.pendingApprovals.map((p: Dict) => (
        <View
          key={p.id}
          style={{
            borderWidth: 1,
            borderColor: v(p.bd),
            borderLeftWidth: 4,
            borderLeftColor: v(p.accent),
            borderRadius: radius.md,
            backgroundColor: v("var(--surface-base)"),
            ...shadowCard,
            paddingVertical: 12,
            paddingHorizontal: 16,
          }}
        >
          <View style={{flexDirection: "row", alignItems: "center", gap: 9}}>
            <Pill label={p.cls} bg={p.clsBg} fg={p.clsFg} fontSize={10} uppercase />
            <Hd style={{fontSize: 14}}>{p.title}</Hd>
            <Txt style={{marginLeft: "auto", fontSize: 11, color: v("var(--text-extra-light)")}}>
              {p.time} · {p.agent}
            </Txt>
          </View>
          <View
            style={{
              marginTop: 8,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: radius.sm,
              backgroundColor: v("var(--neutral-050)"),
              borderWidth: 1,
              borderColor: v("var(--neutral-100)"),
            }}
          >
            <Mono style={{fontSize: 12, color: v("var(--text-secondary-dark)")}}>{p.payload}</Mono>
          </View>
          <View style={{flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10}}>
            <Pressable
              onPress={p.onApprove}
              style={{
                paddingVertical: 5,
                paddingHorizontal: 16,
                borderRadius: radius.rounded,
                backgroundColor: v("var(--surface-success)"),
              }}
            >
              <Txt style={{color: v("var(--text-inverted)"), fontWeight: "700", fontSize: 12}}>
                Approve & run
              </Txt>
            </Pressable>
            <Pressable
              onPress={p.onDeny}
              style={{
                paddingVertical: 5,
                paddingHorizontal: 16,
                borderRadius: radius.rounded,
                borderWidth: 1,
                borderColor: v("var(--border-error)"),
                backgroundColor: v("var(--surface-base)"),
              }}
            >
              <Txt style={{color: v("var(--text-error)"), fontWeight: "700", fontSize: 12}}>
                Deny
              </Txt>
            </Pressable>
            <Txt style={{marginLeft: "auto", fontSize: 10.5, color: v("var(--text-extra-light)")}}>
              held by approval gate · sandbox {p.sandbox}
            </Txt>
          </View>
        </View>
      ))}
      {vm.noPending ? (
        <View
          style={{
            padding: 28,
            alignItems: "center",
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: v("var(--border-default)"),
            borderRadius: radius.md,
          }}
        >
          <Txt style={{color: v("var(--text-extra-light)"), fontSize: 12.5}}>
            Queue is clear. New requests will toast in from the bottom-right.
          </Txt>
        </View>
      ) : null}
    </View>
    <View style={{marginTop: 22, maxWidth: 760}}>
      <SectionLabel style={{marginBottom: 8}}>Recently resolved</SectionLabel>
      <View style={{...card, overflow: "hidden"}}>
        {vm.resolvedRows.map((r: Dict) => (
          <View
            key={r.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderBottomWidth: 1,
              borderBottomColor: v("var(--neutral-050)"),
            }}
          >
            <Pill label={r.verdict} bg={r.bg} fg={r.fg} fontSize={10} />
            <Txt style={{color: v("var(--text-secondary-dark)")}}>{r.title}</Txt>
            <Txt style={{marginLeft: "auto", fontSize: 10.5, color: v("var(--text-extra-light)")}}>
              {r.time} · {r.agent}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  </PaneScroll>
);

// --- Memory -----------------------------------------------------------------
export const MemoryPane: React.FC<{vm: ConsoleVM}> = ({vm}) => (
  <PaneScroll testID="console-pane-memory">
    <PaneHeader
      title="Memory"
      sub="everything Shade carries between conversations — tap to edit, × to forget"
    />
    <View style={{gap: 8, marginTop: 14, maxWidth: 820}}>
      {vm.memRows.map((mm: Dict) => (
        <View
          key={mm.id}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            ...card,
            paddingVertical: 10,
            paddingHorizontal: 14,
          }}
        >
          <Pill label={mm.scope} bg={mm.scopeBg} fg={mm.scopeFg} fontSize={10} />
          {mm.editing ? (
            <TextInput
              value={mm.draft}
              onChangeText={mm.onChange}
              onBlur={mm.onSave}
              onSubmitEditing={mm.onSave}
              autoFocus
              style={{
                flex: 1,
                paddingVertical: 5,
                paddingHorizontal: 9,
                borderWidth: 1,
                borderColor: v("var(--border-focus)"),
                borderRadius: radius.sm,
                fontFamily: fonts.body,
                fontSize: 12.5,
              }}
            />
          ) : (
            <Pressable style={{flex: 1}} onPress={mm.onEdit}>
              <Txt style={{fontSize: 12.5}}>{mm.text}</Txt>
            </Pressable>
          )}
          <Txt style={{fontSize: 10.5, color: v("var(--text-extra-light)")}}>
            {mm.source} · {mm.time}
          </Txt>
          <Pressable onPress={mm.onDelete}>
            <Txt style={{color: v("var(--text-extra-light)"), fontSize: 15}}>×</Txt>
          </Pressable>
        </View>
      ))}
    </View>
    <Txt style={{marginTop: 12, fontSize: 11, color: v("var(--text-extra-light)"), maxWidth: 820}}>
      Edits apply immediately and are versioned in Config — roll back if an edit makes things worse.
    </Txt>
  </PaneScroll>
);

// --- Traces -----------------------------------------------------------------
export const TracesPane: React.FC<{vm: ConsoleVM}> = ({vm}) => (
  <View testID="console-pane-traces" style={{flex: 1, minHeight: 0, flexDirection: "row"}}>
    <ScrollView
      style={{
        width: 280,
        borderRightWidth: 1,
        borderRightColor: v("var(--border-default)"),
        backgroundColor: v("var(--surface-base)"),
      }}
      contentContainerStyle={{paddingVertical: 16, paddingHorizontal: 12}}
    >
      <Hd style={{fontSize: 18, marginHorizontal: 8, marginBottom: 10}}>Traces</Hd>
      {vm.traceList.map((t: Dict) => (
        <Pressable
          key={t.id}
          onPress={t.onClick}
          style={{
            paddingVertical: 9,
            paddingHorizontal: 11,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: v(t.bd),
            backgroundColor: v(t.bg),
            marginBottom: 6,
          }}
        >
          <View style={{flexDirection: "row", alignItems: "center", gap: 7}}>
            <Dot color={t.dot} size={7} />
            <Txt
              style={{fontWeight: "700", fontSize: 12.5, color: v("var(--text-secondary-dark)")}}
            >
              {t.name}
            </Txt>
          </View>
          <Mono style={{fontSize: 10.5, color: v("var(--text-extra-light)"), marginTop: 3}}>
            {t.id} · {t.trigger}
          </Mono>
          <Txt style={{fontSize: 10.5, color: v("var(--text-secondary-light)"), marginTop: 2}}>
            {t.stepsN} steps · {t.dur}
          </Txt>
        </Pressable>
      ))}
    </ScrollView>
    <View style={{flex: 1, minWidth: 0, paddingVertical: 16, paddingHorizontal: 24}}>
      <View style={{flexDirection: "row", alignItems: "center", gap: 10}}>
        <Hd style={{fontSize: 15}}>{vm.selTraceName}</Hd>
        <Mono style={{fontSize: 11, color: v("var(--text-extra-light)")}}>{vm.selTraceId}</Mono>
        <View style={{flex: 1}} />
        <Pressable
          onPress={vm.onReplay}
          style={{
            paddingVertical: 4,
            paddingHorizontal: 13,
            borderRadius: radius.rounded,
            borderWidth: 1,
            borderColor: v("var(--border-active-neutral)"),
            backgroundColor: v("var(--surface-base)"),
          }}
        >
          <Txt style={{color: v("var(--text-secondary-dark)"), fontWeight: "700", fontSize: 11.5}}>
            {vm.replayLabel}
          </Txt>
        </Pressable>
      </View>
      {/* time-travel scrubber: tappable ticks */}
      <View style={{flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 12}}>
        <SectionLabel>Time travel</SectionLabel>
        <View style={{flex: 1, flexDirection: "row", alignItems: "center", gap: 3}}>
          {Array.from({length: vm.scrubMax + 1}).map((_, i) => (
            <Pressable
              key={i}
              onPress={() => vm.onScrub(i)}
              style={{
                flex: 1,
                height: 8,
                borderRadius: 4,
                backgroundColor: v(i <= vm.scrub ? "var(--primary-400)" : "var(--neutral-200)"),
              }}
            />
          ))}
        </View>
        <Mono
          style={{
            fontSize: 11.5,
            color: v("var(--text-secondary-dark)"),
            width: 90,
            textAlign: "right",
          }}
        >
          step {vm.scrubHuman} / {vm.scrubTotal}
        </Mono>
      </View>
      <View style={{flex: 1, minHeight: 0, flexDirection: "row", gap: 14}}>
        <ScrollView style={{flex: 1.2, ...card}}>
          {vm.traceSteps.map((ts: Dict) => (
            <Pressable
              key={ts.key}
              onPress={ts.onClick}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 7,
                paddingHorizontal: 13,
                borderBottomWidth: 1,
                borderBottomColor: v("var(--neutral-050)"),
                backgroundColor: v(ts.bg),
                opacity: ts.op,
              }}
            >
              <Mono style={{fontSize: 10, color: v("var(--text-extra-light)"), width: 44}}>
                {ts.t}
              </Mono>
              <View
                style={{
                  width: 64,
                  borderRadius: radius.rounded,
                  backgroundColor: v(ts.kBg),
                  paddingVertical: 1,
                }}
              >
                <Mono
                  style={{color: v(ts.kFg), fontSize: 9, fontWeight: "700", textAlign: "center"}}
                >
                  {ts.kind}
                </Mono>
              </View>
              <Mono
                numberOfLines={1}
                style={{flex: 1, fontSize: 11.5, color: v("var(--text-primary)")}}
              >
                {ts.label}
              </Mono>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView
          style={{flex: 1, ...card, backgroundColor: v("var(--secondary-000)")}}
          contentContainerStyle={{padding: 15}}
        >
          <SectionLabel>State at step {vm.scrubHuman}</SectionLabel>
          <Hd style={{fontSize: 14, marginTop: 5}}>{vm.snapLabel}</Hd>
          <View style={{flexDirection: "row", gap: 6, marginTop: 7, flexWrap: "wrap"}}>
            {[vm.snapModel, vm.snapTokens, vm.snapT].map((tag, i) => (
              <Pill
                key={i}
                label={String(tag)}
                bg="var(--surface-base)"
                fg="var(--text-secondary-light)"
                border="var(--border-default)"
                fontSize={10}
                bold={false}
              />
            ))}
          </View>
          <SectionLabel style={{marginTop: 13}}>Input</SectionLabel>
          <View
            style={{
              marginTop: 4,
              paddingVertical: 8,
              paddingHorizontal: 10,
              borderRadius: radius.sm,
              backgroundColor: v("var(--surface-base)"),
              borderWidth: 1,
              borderColor: v("var(--border-default)"),
            }}
          >
            <Mono style={{fontSize: 11, color: v("var(--text-secondary-dark)")}}>
              {vm.snapInput}
            </Mono>
          </View>
          <SectionLabel style={{marginTop: 11}}>Output</SectionLabel>
          <View
            style={{
              marginTop: 4,
              paddingVertical: 8,
              paddingHorizontal: 10,
              borderRadius: radius.sm,
              backgroundColor: v("var(--surface-base)"),
              borderWidth: 1,
              borderColor: v("var(--border-default)"),
            }}
          >
            <Mono style={{fontSize: 11, color: v("var(--text-secondary-dark)")}}>
              {vm.snapOutput}
            </Mono>
          </View>
        </ScrollView>
      </View>
    </View>
  </View>
);

// --- Automations ------------------------------------------------------------
export const AutomationsPane: React.FC<{vm: ConsoleVM}> = ({vm}) => (
  <PaneScroll testID="console-pane-auto">
    <PaneHeader title="Automations" sub="schedules and event rules — visual, not YAML" />
    <SectionLabel style={{marginTop: 16, marginBottom: 8}}>Scheduled tasks</SectionLabel>
    <View style={{...card, overflow: "hidden", maxWidth: 980}}>
      <View
        style={{
          flexDirection: "row",
          gap: 10,
          paddingVertical: 8,
          paddingHorizontal: 14,
          backgroundColor: v("var(--neutral-050)"),
          borderBottomWidth: 1,
          borderBottomColor: v("var(--border-default)"),
        }}
      >
        {[
          ["Task", 1.4],
          ["Schedule", 1],
          ["Class", 0.7],
          ["Context", 0.7],
          ["Next run", 1],
          ["Runs", 0.5],
        ].map(([h, f]) => (
          <Mono
            key={String(h)}
            style={{
              flex: f as number,
              fontSize: 10,
              fontWeight: "700",
              color: v("var(--text-extra-light)"),
              letterSpacing: 0.5,
            }}
          >
            {String(h).toUpperCase()}
          </Mono>
        ))}
        <View style={{width: 90}} />
      </View>
      {vm.schedRows.map((sd: Dict) => (
        <View
          key={sd.id}
          style={{
            flexDirection: "row",
            gap: 10,
            paddingVertical: 9,
            paddingHorizontal: 14,
            borderBottomWidth: 1,
            borderBottomColor: v("var(--neutral-050)"),
            alignItems: "center",
          }}
        >
          <Txt
            style={{
              flex: 1.4,
              fontWeight: "700",
              fontSize: 12,
              color: v("var(--text-secondary-dark)"),
            }}
          >
            {sd.name}
          </Txt>
          <Mono style={{flex: 1, fontSize: 11, color: v("var(--text-secondary-light)")}}>
            {sd.sched}
          </Mono>
          <View style={{flex: 0.7}}>
            <Pill label={sd.cls} bg={sd.clsBg} fg={sd.clsFg} fontSize={10} />
          </View>
          <Txt style={{flex: 0.7, fontSize: 11, color: v("var(--text-extra-light)")}}>{sd.ctx}</Txt>
          <Txt style={{flex: 1, fontSize: 11.5, color: v("var(--text-link)"), fontWeight: "700"}}>
            {sd.next}
          </Txt>
          <Txt style={{flex: 0.5, fontSize: 11, color: v("var(--text-extra-light)")}}>
            {sd.runs}
          </Txt>
          <Pressable
            onPress={sd.onToggle}
            style={{
              width: 90,
              paddingVertical: 3,
              borderRadius: radius.rounded,
              borderWidth: 1,
              borderColor: v(sd.tBd),
              backgroundColor: v(sd.tBg),
              alignItems: "center",
            }}
          >
            <Txt style={{fontSize: 10.5, fontWeight: "700", color: v(sd.tFg)}}>{sd.tLabel}</Txt>
          </Pressable>
        </View>
      ))}
    </View>
    <SectionLabel style={{marginTop: 20, marginBottom: 8}}>Event rules</SectionLabel>
    <View style={{gap: 8, maxWidth: 980}}>
      {vm.ruleRows.map((rl: Dict) => (
        <View
          key={rl.id}
          style={{flexDirection: "row", alignItems: "center", ...card, overflow: "hidden"}}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingVertical: 10,
              paddingHorizontal: 14,
              flex: 1,
              flexWrap: "wrap",
            }}
          >
            <Pill
              label="WHEN"
              bg="var(--secondary-000)"
              fg="var(--secondary-600)"
              border="var(--secondary-100)"
              fontSize={9.5}
            />
            <Txt style={{fontSize: 12, color: v("var(--text-secondary-dark)"), fontWeight: "600"}}>
              {rl.when}
            </Txt>
            <Pill
              label="IF"
              bg="var(--accent-050)"
              fg="var(--accent-800)"
              border="var(--accent-200)"
              fontSize={9.5}
            />
            <Txt style={{fontSize: 12, color: v("var(--text-secondary-light)")}}>{rl.cond}</Txt>
            <Pill
              label="THEN"
              bg="var(--primary-000)"
              fg="var(--primary-700)"
              border="var(--primary-100)"
              fontSize={9.5}
            />
            <Txt style={{fontSize: 12, color: v("var(--text-secondary-dark)"), fontWeight: "600"}}>
              {rl.then}
            </Txt>
          </View>
          <Pressable
            onPress={rl.onToggle}
            style={{
              marginHorizontal: 12,
              paddingVertical: 3,
              paddingHorizontal: 12,
              borderRadius: radius.rounded,
              borderWidth: 1,
              borderColor: v(rl.tBd),
              backgroundColor: v(rl.tBg),
            }}
          >
            <Txt style={{fontSize: 10.5, fontWeight: "700", color: v(rl.tFg)}}>{rl.tLabel}</Txt>
          </Pressable>
        </View>
      ))}
    </View>
  </PaneScroll>
);

// --- Config -----------------------------------------------------------------
export const ConfigPane: React.FC<{vm: ConsoleVM}> = ({vm}) => (
  <View testID="console-pane-config" style={{flex: 1, minHeight: 0, flexDirection: "row"}}>
    <ScrollView
      style={{
        width: 300,
        borderRightWidth: 1,
        borderRightColor: v("var(--border-default)"),
        backgroundColor: v("var(--surface-base)"),
      }}
      contentContainerStyle={{paddingVertical: 16, paddingHorizontal: 14}}
    >
      <Hd style={{fontSize: 18, marginHorizontal: 4}}>Config</Hd>
      <Txt
        style={{
          fontSize: 11,
          color: v("var(--text-extra-light)"),
          marginHorizontal: 4,
          marginBottom: 12,
        }}
      >
        every change is a version — roll back anytime
      </Txt>
      {vm.verRows.map((vr: Dict) => (
        <View
          key={vr.v}
          style={{
            borderWidth: 1,
            borderColor: v(vr.bd),
            borderRadius: radius.md,
            backgroundColor: v(vr.bg),
            paddingVertical: 9,
            paddingHorizontal: 11,
            marginBottom: 7,
          }}
        >
          <View style={{flexDirection: "row", alignItems: "center", gap: 7}}>
            <Mono style={{fontWeight: "700", fontSize: 12, color: v("var(--text-secondary-dark)")}}>
              {vr.v}
            </Mono>
            {vr.current ? (
              <Pill
                label="CURRENT"
                bg="var(--surface-success-light)"
                fg="var(--text-success)"
                border="var(--border-success)"
                fontSize={9.5}
              />
            ) : null}
            <Txt style={{marginLeft: "auto", fontSize: 10, color: v("var(--text-extra-light)")}}>
              {vr.time}
            </Txt>
          </View>
          <Txt style={{fontSize: 11.5, color: v("var(--text-primary)"), marginTop: 4}}>
            {vr.desc}
          </Txt>
          <View style={{flexDirection: "row", alignItems: "center", marginTop: 5}}>
            <Txt style={{fontSize: 10, color: v("var(--text-extra-light)")}}>by {vr.author}</Txt>
            {vr.canRollback ? (
              <Pressable
                onPress={vr.onRollback}
                style={{
                  marginLeft: "auto",
                  paddingVertical: 2,
                  paddingHorizontal: 10,
                  borderRadius: radius.rounded,
                  borderWidth: 1,
                  borderColor: v("var(--border-active-neutral)"),
                  backgroundColor: v("var(--surface-base)"),
                }}
              >
                <Txt
                  style={{fontSize: 10, fontWeight: "700", color: v("var(--text-secondary-dark)")}}
                >
                  Roll back
                </Txt>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </ScrollView>
    <ScrollView
      style={{flex: 1}}
      contentContainerStyle={{paddingVertical: 16, paddingHorizontal: 24}}
    >
      <SectionLabel style={{marginBottom: 8}}>Model routing</SectionLabel>
      <View style={{...card, overflow: "visible", maxWidth: 720}}>
        {vm.routeRows.map((rr: Dict, i: number) => (
          <View
            key={i}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingVertical: 9,
              paddingHorizontal: 14,
              borderBottomWidth: 1,
              borderBottomColor: v("var(--neutral-050)"),
              zIndex: vm.routeRows.length - i,
            }}
          >
            <Txt
              style={{
                width: 190,
                fontWeight: "700",
                fontSize: 12.5,
                color: v("var(--text-secondary-dark)"),
              }}
            >
              {rr.task}
            </Txt>
            <Select value={rr.sel} options={rr.options} onChange={rr.onChange} minWidth={230} />
            {rr.isLocal ? (
              <Pill
                label="LOCAL"
                bg="var(--surface-success-light)"
                fg="var(--text-success)"
                border="var(--border-success)"
                fontSize={10}
              />
            ) : null}
            {rr.blocked ? (
              <Pill
                label="offline — falls back to local"
                bg="var(--surface-warning-light)"
                fg="var(--text-warning)"
                border="var(--border-warning)"
                fontSize={10}
                bold={false}
              />
            ) : null}
          </View>
        ))}
      </View>
      <SectionLabel style={{marginTop: 20, marginBottom: 8}}>MCP servers</SectionLabel>
      <View style={{...card, overflow: "hidden", maxWidth: 720}}>
        {vm.mcpRows.map((mc: Dict, i: number) => (
          <View
            key={i}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingVertical: 9,
              paddingHorizontal: 14,
              borderBottomWidth: 1,
              borderBottomColor: v("var(--neutral-050)"),
            }}
          >
            <Dot color={mc.dot} size={8} />
            <Txt style={{fontWeight: "700", color: v("var(--text-secondary-dark)"), width: 160}}>
              {mc.name}
            </Txt>
            <Mono style={{fontSize: 10.5, color: v("var(--text-extra-light)"), width: 60}}>
              {mc.transport}
            </Mono>
            <Txt style={{fontSize: 11, color: v("var(--text-secondary-light)")}}>
              {mc.tools} tools
            </Txt>
            <Txt style={{marginLeft: "auto", fontSize: 11, color: v(mc.stFg), fontWeight: "700"}}>
              {mc.status}
            </Txt>
          </View>
        ))}
      </View>
      <SectionLabel style={{marginTop: 20, marginBottom: 8}}>Egress allowlist</SectionLabel>
      <View style={{...card, padding: 14, maxWidth: 720}}>
        <View style={{flexDirection: "row", flexWrap: "wrap", gap: 6}}>
          {vm.egressChips.map((eg: Dict, i: number) => (
            <View
              key={i}
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
              <Mono style={{fontSize: 11, color: v("var(--text-secondary-dark)")}}>{eg.host}</Mono>
              <Pressable onPress={eg.onRemove}>
                <Txt style={{color: v("var(--text-extra-light)"), fontSize: 13}}>×</Txt>
              </Pressable>
            </View>
          ))}
        </View>
        <View style={{flexDirection: "row", gap: 8, marginTop: 10}}>
          <TextInput
            value={vm.egressDraft}
            onChangeText={vm.onEgressDraft}
            onSubmitEditing={vm.onEgressAdd}
            placeholder="add host, e.g. api.tmdb.org"
            placeholderTextColor={v("var(--text-extra-light)")}
            style={{
              flex: 1,
              maxWidth: 280,
              paddingVertical: 5,
              paddingHorizontal: 10,
              borderWidth: 1,
              borderColor: v("var(--border-default)"),
              borderRadius: radius.md,
              fontFamily: fonts.mono,
              fontSize: 11.5,
            }}
          />
          <Pressable
            onPress={vm.onEgressAdd}
            style={{
              paddingVertical: 5,
              paddingHorizontal: 13,
              borderRadius: radius.rounded,
              borderWidth: 1,
              borderColor: v("var(--border-active-neutral)"),
              backgroundColor: v("var(--surface-base)"),
            }}
          >
            <Txt
              style={{color: v("var(--text-secondary-dark)"), fontWeight: "700", fontSize: 11.5}}
            >
              Allow
            </Txt>
          </Pressable>
        </View>
        <Txt style={{fontSize: 10.5, color: v("var(--text-extra-light)"), marginTop: 8}}>
          Everything else is blocked at the sandbox boundary. Every egress hit is logged in
          Activity.
        </Txt>
      </View>
    </ScrollView>
  </View>
);
