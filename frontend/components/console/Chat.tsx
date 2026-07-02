// Chat column for the Shade Console — branch action bar, the message stream
// (user / shade / tool / untrusted / plan / feature / system rows), the typing
// indicator, and the composer with plan-first toggle + model selector.

import type React from "react";
import {Pressable, ScrollView, TextInput, View} from "react-native";
import {fonts, radius, v} from "@/constants/consoleTokens";
import type {ConsoleVM} from "@/hooks/useShadeConsole";
import {Dot, Hd, Icon, Mono, ProgressBar, SAvatar, Select, Txt, TypingDots} from "./primitives";

type Dict = Record<string, any>;

const BRANCH_ICON =
  "M7 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M7 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M17 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M7 8v8 M17 8c0 5-7 3-9 7";

const stepBullet = (st: Dict, size: number) => {
  if (st.isDone) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: v("var(--success-100)"),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Txt style={{color: "#fff", fontSize: size * 0.62}}>✓</Txt>
      </View>
    );
  }
  if (st.isProg) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: v("var(--primary-400)"),
          borderTopColor: "transparent",
        }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: v("var(--border-dark)"),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Txt style={{color: v("var(--text-extra-light)"), fontSize: size * 0.6}}>{st.n}</Txt>
    </View>
  );
};

const PlanCard: React.FC<{m: Dict}> = ({m}) => (
  <View
    style={{
      marginLeft: 34,
      maxWidth: "88%",
      borderWidth: 1,
      borderColor: v("var(--neutral-100)"),
      borderRadius: radius.md,
      backgroundColor: v("var(--surface-base)"),
      overflow: "hidden",
    }}
  >
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 9,
        paddingHorizontal: 13,
        borderBottomWidth: 1,
        borderBottomColor: v("var(--neutral-050)"),
      }}
    >
      <Hd style={{fontSize: 13}}>{m.planTitle}</Hd>
      <View
        style={{
          paddingVertical: 2,
          paddingHorizontal: 8,
          borderRadius: radius.rounded,
          backgroundColor: v(m.planBadgeBg),
        }}
      >
        <Txt style={{fontSize: 10, fontWeight: "700", color: v(m.planBadgeFg)}}>{m.planStatus}</Txt>
      </View>
    </View>
    {m.planSteps.map((st: Dict, i: number) => (
      <View
        key={i}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 9,
          paddingVertical: 7,
          paddingHorizontal: 13,
          borderBottomWidth: 1,
          borderBottomColor: v("var(--neutral-050)"),
        }}
      >
        {stepBullet(st, 16)}
        {st.editing ? (
          <TextInput
            value={st.draft}
            onChangeText={st.onChange}
            onBlur={st.onSave}
            onSubmitEditing={st.onSave}
            autoFocus
            style={{
              flex: 1,
              paddingVertical: 4,
              paddingHorizontal: 8,
              borderWidth: 1,
              borderColor: v("var(--border-focus)"),
              borderRadius: radius.sm,
              fontFamily: fonts.body,
              fontSize: 12.5,
            }}
          />
        ) : (
          <Pressable style={{flex: 1}} onPress={st.onEdit}>
            <Txt style={{fontSize: 12.5}}>{st.text}</Txt>
          </Pressable>
        )}
        {st.canRemove ? (
          <Pressable onPress={st.onRemove}>
            <Txt style={{color: v("var(--text-extra-light)"), fontSize: 15}}>×</Txt>
          </Pressable>
        ) : null}
      </View>
    ))}
    {m.planProposed ? (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 9,
          paddingHorizontal: 13,
          backgroundColor: v("var(--neutral-050)"),
          flexWrap: "wrap",
        }}
      >
        <Pressable
          onPress={m.onRunPlan}
          style={{
            paddingVertical: 5,
            paddingHorizontal: 14,
            borderRadius: radius.rounded,
            backgroundColor: v("var(--surface-primary)"),
          }}
        >
          <Txt style={{color: v("var(--text-inverted)"), fontWeight: "700", fontSize: 12}}>
            ▶ Run plan
          </Txt>
        </Pressable>
        <Pressable
          onPress={m.onDryRun}
          style={{
            paddingVertical: 5,
            paddingHorizontal: 14,
            borderRadius: radius.rounded,
            borderWidth: 1,
            borderColor: v("var(--border-active-neutral)"),
            backgroundColor: v("var(--surface-base)"),
          }}
        >
          <Txt style={{color: v("var(--text-secondary-dark)"), fontWeight: "700", fontSize: 12}}>
            Dry run — no side effects
          </Txt>
        </Pressable>
        <Pressable
          onPress={m.onAddStep}
          style={{
            paddingVertical: 5,
            paddingHorizontal: 11,
            borderRadius: radius.rounded,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: v("var(--border-dark)"),
          }}
        >
          <Txt style={{color: v("var(--text-secondary-light)"), fontWeight: "600", fontSize: 12}}>
            + Step
          </Txt>
        </Pressable>
      </View>
    ) : null}
    {m.planDry ? (
      <View
        style={{
          paddingVertical: 8,
          paddingHorizontal: 13,
          backgroundColor: v("var(--secondary-000)"),
        }}
      >
        <Txt style={{fontSize: 11.5, color: v("var(--text-secondary-dark)")}}>
          Dry run — simulated only. 0 files written, 0 messages sent. Run for real when ready.
        </Txt>
      </View>
    ) : null}
  </View>
);

const FeatureChatCard: React.FC<{m: Dict}> = ({m}) => (
  <View
    style={{
      marginLeft: 34,
      maxWidth: "88%",
      borderWidth: 1,
      borderColor: v("var(--neutral-100)"),
      borderRadius: radius.md,
      backgroundColor: v("var(--surface-base)"),
      overflow: "hidden",
    }}
  >
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingVertical: 10,
        paddingHorizontal: 14,
      }}
    >
      <Icon d="M12 3l9 5-9 5-9-5 9-5z M3 13l9 5 9-5" color="var(--secondary-500)" size={15} />
      <Hd style={{fontSize: 14}}>{m.fName}</Hd>
      <View
        style={{
          paddingVertical: 2,
          paddingHorizontal: 8,
          borderRadius: radius.rounded,
          backgroundColor: v(m.fBadgeBg),
        }}
      >
        <Txt style={{fontSize: 10, fontWeight: "700", color: v(m.fBadgeFg)}}>{m.fStatus}</Txt>
      </View>
      <View style={{flex: 1}} />
      <Txt style={{fontSize: 11.5, fontWeight: "700", color: v("var(--text-secondary-dark)")}}>
        {m.fPct}%
      </Txt>
    </View>
    <View style={{marginHorizontal: 14}}>
      <ProgressBar pct={m.fPct} />
    </View>
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 14,
        paddingTop: 9,
        paddingBottom: 11,
      }}
    >
      <Txt style={{fontSize: 11.5, color: v("var(--text-secondary-light)")}}>{m.fStep}</Txt>
      <View style={{flex: 1}} />
      <Pressable
        onPress={m.onDemo}
        style={{
          paddingVertical: 4,
          paddingHorizontal: 11,
          borderRadius: radius.rounded,
          borderWidth: 1,
          borderColor: v("var(--primary-300)"),
          backgroundColor: v("var(--primary-000)"),
        }}
      >
        <Txt style={{color: v("var(--text-link)"), fontWeight: "700", fontSize: 11.5}}>
          ▶ Open demo
        </Txt>
      </Pressable>
      <Pressable
        onPress={m.onViewFeature}
        style={{
          paddingVertical: 4,
          paddingHorizontal: 11,
          borderRadius: radius.rounded,
          borderWidth: 1,
          borderColor: v("var(--border-default)"),
          backgroundColor: v("var(--surface-base)"),
        }}
      >
        <Txt style={{color: v("var(--text-secondary-dark)"), fontWeight: "600", fontSize: 11.5}}>
          View feature →
        </Txt>
      </Pressable>
    </View>
  </View>
);

const ChatMessage: React.FC<{m: Dict}> = ({m}) => {
  if (m.isUser) {
    return (
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 6,
          paddingLeft: 60,
          marginTop: 6,
        }}
      >
        <Pressable onPress={m.onBranch} style={{opacity: 0.3, padding: 2}}>
          <Icon d={BRANCH_ICON} color="var(--text-secondary-light)" size={13} />
        </Pressable>
        <View
          style={{
            maxWidth: "85%",
            backgroundColor: v("var(--secondary-000)"),
            borderWidth: 1,
            borderColor: v("var(--secondary-050)"),
            paddingVertical: 8,
            paddingHorizontal: 13,
            borderRadius: 12,
            borderBottomRightRadius: 4,
          }}
        >
          <Txt style={{fontSize: 13, lineHeight: 19}}>{m.text}</Txt>
        </View>
      </View>
    );
  }
  if (m.isShade) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 10,
          paddingRight: 60,
          marginTop: 6,
        }}
      >
        <SAvatar size={24} />
        <View style={{minWidth: 0, flex: 1}}>
          <Txt style={{fontSize: 13, lineHeight: 19}}>{m.text}</Txt>
          <View style={{flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3}}>
            <Txt style={{fontSize: 10, color: v("var(--neutral-400)")}}>
              {m.time} · {m.model}
            </Txt>
            <Pressable onPress={m.onBranch} style={{opacity: 0.35}}>
              <Icon d={BRANCH_ICON} color="var(--text-secondary-light)" size={12} />
            </Pressable>
          </View>
        </View>
      </View>
    );
  }
  if (m.isTool) {
    return (
      <View
        style={{flexDirection: "row", alignItems: "center", gap: 7, marginLeft: 34, marginTop: 6}}
      >
        <Icon d="M3 12h4l2.5-7 5 14 2.5-7H21" color="var(--neutral-500)" size={11} />
        <Mono numberOfLines={1} style={{fontSize: 11, color: v("var(--neutral-500)"), flex: 1}}>
          {m.text}
        </Mono>
      </View>
    );
  }
  if (m.isUntrusted) {
    return (
      <View
        style={{
          marginLeft: 34,
          maxWidth: "85%",
          borderWidth: 1,
          borderColor: v("var(--warning-000)"),
          borderRadius: radius.md,
          backgroundColor: v("var(--surface-base)"),
          overflow: "hidden",
          marginTop: 6,
        }}
      >
        <Pressable
          onPress={m.onToggleTrust}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            paddingVertical: 6,
            paddingHorizontal: 11,
            backgroundColor: v("var(--surface-warning-light)"),
          }}
        >
          <Icon
            d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z M9 12l2 2 4-4"
            color="var(--text-warning)"
            size={12}
          />
          <Txt
            numberOfLines={1}
            style={{
              fontSize: 11,
              fontWeight: "700",
              color: v("var(--text-warning)"),
              flexShrink: 1,
            }}
          >
            Untrusted content · {m.source}
          </Txt>
          {m.hasBlocked ? (
            <View
              style={{
                paddingVertical: 1,
                paddingHorizontal: 7,
                borderRadius: radius.rounded,
                backgroundColor: v("var(--surface-error-light)"),
              }}
            >
              <Txt style={{color: v("var(--text-error)"), fontSize: 9.5, fontWeight: "700"}}>
                1 injection blocked
              </Txt>
            </View>
          ) : null}
          <View style={{marginLeft: "auto"}}>
            <Txt style={{color: v("var(--text-extra-light)"), fontSize: 10}}>{m.trustChevron}</Txt>
          </View>
        </Pressable>
        {m.trustOpen ? (
          <View>
            <View
              style={{
                paddingVertical: 9,
                paddingHorizontal: 12,
                borderTopWidth: 1,
                borderTopColor: v("var(--warning-000)"),
              }}
            >
              <Txt
                style={{
                  fontSize: 12,
                  color: v("var(--text-secondary-light)"),
                  fontStyle: "italic",
                  lineHeight: 18,
                }}
              >
                {m.body}
              </Txt>
            </View>
            {m.hasBlocked ? (
              <View
                style={{
                  marginHorizontal: 12,
                  marginBottom: 10,
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  borderRadius: radius.sm,
                  backgroundColor: v("var(--surface-error-light)"),
                }}
              >
                <Txt style={{fontSize: 11, color: v("var(--text-error)")}}>
                  <Txt style={{fontWeight: "700"}}>Blocked:</Txt> “{m.blocked}” — stripped, treated
                  as data, logged to Activity.
                </Txt>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }
  if (m.isPlan) {
    return <PlanCard m={m} />;
  }
  if (m.isFeature) {
    return <FeatureChatCard m={m} />;
  }
  if (m.isSystem) {
    return (
      <View
        style={{
          alignSelf: "center",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 4,
          paddingHorizontal: 12,
          borderRadius: radius.rounded,
          backgroundColor: v("var(--neutral-050)"),
          borderWidth: 1,
          borderColor: v("var(--border-default)"),
        }}
      >
        <Txt style={{fontSize: 11, color: v("var(--text-secondary-light)")}}>{m.text}</Txt>
      </View>
    );
  }
  return null;
};

interface ChatProps {
  vm: ConsoleVM;
}

export const Chat: React.FC<ChatProps> = ({vm}) => (
  <View
    testID="console-chat"
    style={{
      flexDirection: "column",
      minWidth: 0,
      backgroundColor: v("var(--surface-base)"),
      borderRightWidth: 1,
      borderRightColor: v("var(--border-default)"),
      flexGrow: vm.chatFlex,
      flexShrink: 1,
      flexBasis: vm.chatFixedWidth ?? "auto",
      width: vm.chatFixedWidth,
    }}
  >
    {/* action bar */}
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 9,
        paddingHorizontal: 14,
        borderBottomWidth: 1,
        borderBottomColor: v("var(--border-default)"),
        zIndex: 20,
      }}
    >
      <Select
        value={vm.activeBranchId}
        options={vm.branchOpts}
        onChange={vm.onBranchSel}
        maxWidth={230}
        testID="console-branch-select"
      />
      <Pressable
        onPress={vm.onNewBranch}
        style={{
          paddingVertical: 4,
          paddingHorizontal: 11,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: v("var(--border-default)"),
        }}
      >
        <Txt style={{color: v("var(--text-secondary-light)"), fontSize: 11.5, fontWeight: "600"}}>
          ⑂ Branch
        </Txt>
      </Pressable>
      <Pressable
        onPress={vm.onPromote}
        style={{
          paddingVertical: 4,
          paddingHorizontal: 11,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: v("var(--border-default)"),
        }}
      >
        <Txt style={{color: v("var(--text-secondary-dark)"), fontSize: 11.5, fontWeight: "600"}}>
          ↗ Promote to feature
        </Txt>
      </Pressable>
      <View style={{flex: 1}} />
      <Txt
        numberOfLines={1}
        style={{fontSize: 11, color: v("var(--text-extra-light)"), maxWidth: 240}}
      >
        {vm.branchOrigin}
      </Txt>
    </View>

    {/* messages */}
    <MessagesScroller vm={vm} />

    {/* composer */}
    <View
      style={{
        paddingTop: 10,
        paddingHorizontal: 14,
        paddingBottom: 12,
        borderTopWidth: 1,
        borderTopColor: v("var(--border-default)"),
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderWidth: 1,
          borderColor: v("var(--border-default)"),
          borderRadius: radius.rounded,
          paddingVertical: 4,
          paddingRight: 4,
          paddingLeft: 14,
          backgroundColor: v("var(--neutral-050)"),
        }}
      >
        <TextInput
          testID="console-composer-input"
          value={vm.composer}
          onChangeText={vm.onComposer}
          onSubmitEditing={vm.onSend}
          placeholder={vm.composerPlaceholder}
          placeholderTextColor={v("var(--text-extra-light)")}
          style={{
            flex: 1,
            fontFamily: fonts.body,
            fontSize: 13,
            color: v("var(--text-primary)"),
            paddingVertical: 6,
          }}
        />
        <Pressable
          testID="console-composer-send"
          onPress={vm.onSend}
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: v("var(--surface-primary)"),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon d="M5 12h13 M13 6l6 6-6 6" color="var(--text-inverted)" size={14} strokeWidth={2} />
        </Pressable>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginTop: 7,
          paddingHorizontal: 2,
          zIndex: 10,
        }}
      >
        <Pressable
          onPress={vm.togglePlan}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 3,
            paddingHorizontal: 10,
            borderRadius: radius.rounded,
            borderWidth: 1,
            borderColor: v(vm.planBd),
            backgroundColor: v(vm.planBg),
          }}
        >
          <Dot color={vm.planDot} size={6} />
          <Txt style={{color: v(vm.planFg), fontSize: 11, fontWeight: "700"}}>Plan first</Txt>
        </Pressable>
        <Select
          value={vm.chatModel}
          options={vm.chatModelOptions}
          onChange={vm.onChatModel}
          variant="plain"
          width={150}
        />
        <View style={{flex: 1}} />
        <Txt
          numberOfLines={1}
          style={{fontSize: 10.5, color: v("var(--text-extra-light)"), flexShrink: 1}}
        >
          {vm.routingFooter}
        </Txt>
      </View>
    </View>
  </View>
);

// Messages list uses a real ScrollView so scrollToEnd works.
const MessagesScroller: React.FC<{vm: ConsoleVM}> = ({vm}) => (
  <ScrollView
    ref={vm.chatScrollRef}
    style={{flex: 1}}
    contentContainerStyle={{paddingTop: 18, paddingHorizontal: 18, paddingBottom: 10, gap: 12}}
  >
    <View style={{alignSelf: "center"}}>
      <Mono
        style={{
          fontSize: 10.5,
          fontWeight: "700",
          letterSpacing: 0.7,
          color: v("var(--text-extra-light)"),
        }}
      >
        TODAY
      </Mono>
    </View>
    {vm.messages.map((m: Dict) => (
      <View key={m.id}>
        <ChatMessage m={m} />
      </View>
    ))}
    {vm.typing ? (
      <View style={{flexDirection: "row", alignItems: "flex-end", gap: 8}}>
        <SAvatar size={26} />
        <TypingDots />
      </View>
    ) : null}
  </ScrollView>
);
