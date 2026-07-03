// Small shared primitives used across the Shade Console panes: an SVG path
// icon, a cross-platform Select, animated "live"/typing indicators, a progress
// bar, and a couple of style helpers.

import {Text} from "@terreno/ui";
import type React from "react";
import {useEffect, useRef, useState} from "react";
import {Animated, Pressable, ScrollView, View} from "react-native";
// --- Icon -------------------------------------------------------------------
// The design draws icons as one or more SVG <path d="…"> strings (space
// separated subpaths in a single d). We render them with react-native-svg.
import Svg, {Path} from "react-native-svg";
import {fonts, radius, shadowFloating, v} from "@/constants/consoleTokens";

interface IconProps {
  d: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export const Icon: React.FC<IconProps> = ({
  d,
  size = 16,
  color = "currentColor",
  strokeWidth = 1.8,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d={d}
      stroke={v(color)}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// --- Dot --------------------------------------------------------------------
interface DotProps {
  color: string;
  size?: number;
}

export const Dot: React.FC<DotProps> = ({color, size = 8}) => (
  <View style={{width: size, height: size, borderRadius: size / 2, backgroundColor: v(color)}} />
);

// Pulsing presence dot (replaces the CSS sh-live keyframe).
export const LiveDot: React.FC<DotProps> = ({color, size = 8}) => {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, {toValue: 0.3, duration: 800, useNativeDriver: true}),
        Animated.timing(op, {toValue: 1, duration: 800, useNativeDriver: true}),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [op]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: v(color),
        opacity: op,
      }}
    />
  );
};

// Three-dot typing indicator (replaces the CSS sh-typing keyframe).
export const TypingDots: React.FC = () => {
  const dots = [
    useRef(new Animated.Value(0.25)).current,
    useRef(new Animated.Value(0.25)).current,
    useRef(new Animated.Value(0.25)).current,
  ];
  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(d, {toValue: 1, duration: 300, useNativeDriver: true}),
          Animated.timing(d, {toValue: 0.25, duration: 500, useNativeDriver: true}),
          Animated.delay(400 - i * 200),
        ])
      )
    );
    for (const l of loops) {
      l.start();
    }
    return () => {
      for (const l of loops) {
        l.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View
      style={{
        backgroundColor: v("var(--neutral-050)"),
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderBottomLeftRadius: 4,
        flexDirection: "row",
        gap: 4,
      }}
    >
      {dots.map((d, i) => (
        <Animated.View
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: v("var(--neutral-500)"),
            opacity: d,
          }}
        />
      ))}
    </View>
  );
};

// --- ProgressBar ------------------------------------------------------------
interface ProgressBarProps {
  pct: number;
  height?: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({pct, height = 6}) => (
  <View
    style={{height, borderRadius: 3, backgroundColor: v("var(--neutral-100)"), overflow: "hidden"}}
  >
    <View
      style={{
        height: "100%",
        borderRadius: 3,
        backgroundColor: v("var(--surface-primary)"),
        width: `${pct}%`,
      }}
    />
  </View>
);

// --- Select -----------------------------------------------------------------
// A lightweight dropdown — RN has no native <select>. Tapping toggles an
// absolute-positioned option list.
export interface SelectOption {
  v: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  testID?: string;
  width?: number;
  maxWidth?: number;
  minWidth?: number;
  variant?: "bordered" | "plain";
}

export const Select: React.FC<SelectProps> = ({
  value,
  options,
  onChange,
  testID,
  width,
  maxWidth,
  minWidth,
  variant = "bordered",
}) => {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.v === value);
  const bordered = variant === "bordered";
  return (
    <View style={{position: "relative", width, maxWidth, minWidth, zIndex: open ? 50 : undefined}}>
      <Pressable
        testID={testID}
        onPress={() => setOpen((p) => !p)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 4,
          paddingHorizontal: bordered ? 8 : 4,
          borderRadius: radius.md,
          borderWidth: bordered ? 1 : 0,
          borderColor: v("var(--border-default)"),
          backgroundColor: bordered ? v("var(--surface-base)") : "transparent",
        }}
      >
        <Text size="sm" color="secondaryDark" truncate>
          {selected?.label ?? value}
        </Text>
        <View style={{marginLeft: "auto"}}>
          <Text size="sm" color="extraLight">
            {open ? "▴" : "▾"}
          </Text>
        </View>
      </Pressable>
      {open ? (
        <View
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            minWidth: 220,
            backgroundColor: v("var(--surface-base)"),
            borderWidth: 1,
            borderColor: v("var(--border-default)"),
            borderRadius: radius.md,
            ...shadowFloating,
            zIndex: 60,
          }}
        >
          <ScrollView style={{maxHeight: 240}}>
            {options.map((o) => (
              <Pressable
                key={o.v}
                onPress={() => {
                  onChange(o.v);
                  setOpen(false);
                }}
                style={{
                  paddingVertical: 7,
                  paddingHorizontal: 10,
                  backgroundColor: o.v === value ? v("var(--secondary-000)") : "transparent",
                }}
              >
                <Text size="sm" color="secondaryDark">
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
};

// --- Pill -------------------------------------------------------------------
// The most common motif in the design: a small rounded label chip.
interface PillProps {
  label: string;
  bg?: string;
  fg?: string;
  border?: string;
  fontSize?: number;
  bold?: boolean;
  uppercase?: boolean;
}

export const Pill: React.FC<PillProps> = ({
  label,
  bg = "var(--neutral-050)",
  fg = "var(--text-secondary-light)",
  border,
  fontSize = 10,
  bold = true,
  uppercase = false,
}) => (
  <View
    style={{
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: radius.rounded,
      backgroundColor: v(bg),
      borderWidth: border ? 1 : 0,
      borderColor: v(border),
      alignSelf: "flex-start",
    }}
  >
    <Mono
      style={{
        fontSize,
        fontWeight: bold ? "700" : "400",
        color: v(fg),
        letterSpacing: uppercase ? 0.5 : 0,
      }}
    >
      {uppercase ? label.toUpperCase() : label}
    </Mono>
  </View>
);

// --- Raw text helpers -------------------------------------------------------
// @terreno/ui's Text uses a fixed size scale; the console relies on many exact
// pixel sizes and arbitrary colors, so we use a thin RN Text wrapper for those.
import {Text as RNText, type TextProps as RNTextProps} from "react-native";

interface TxtProps extends RNTextProps {
  children: React.ReactNode;
}

// Body text with the console's body font.
export const Txt: React.FC<TxtProps> = ({style, children, ...rest}) => (
  <RNText style={[{fontFamily: fonts.body, color: v("var(--text-primary)")}, style]} {...rest}>
    {children}
  </RNText>
);

// Heading text with the console's heading font.
export const Hd: React.FC<TxtProps> = ({style, children, ...rest}) => (
  <RNText
    style={[
      {fontFamily: fonts.heading, fontWeight: "700", color: v("var(--text-secondary-dark)")},
      style,
    ]}
    {...rest}
  >
    {children}
  </RNText>
);

// Monospace text (SpaceMono is bundled).
export const Mono: React.FC<TxtProps> = ({style, children, ...rest}) => (
  <RNText
    style={[{fontFamily: fonts.mono, color: v("var(--text-secondary-dark)")}, style]}
    {...rest}
  >
    {children}
  </RNText>
);

// The "S" avatar mark used throughout (titlebar, orchestrator, chat).
interface AvatarProps {
  size?: number;
}

export const SAvatar: React.FC<AvatarProps> = ({size = 24}) => (
  <View
    style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: v("var(--secondary-700)"),
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <Hd style={{color: v("var(--accent-300)"), fontSize: size * 0.5}}>S</Hd>
  </View>
);

// Uppercase section label ("CHANNELS IN", "MODEL ROUTING", …).
export const SectionLabel: React.FC<{children: React.ReactNode; style?: object}> = ({
  children,
  style,
}) => (
  <Mono
    style={[
      {fontSize: 10.5, fontWeight: "700", letterSpacing: 0.7, color: v("var(--text-extra-light)")},
      style,
    ]}
  >
    {String(children).toUpperCase()}
  </Mono>
);
