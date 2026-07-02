// Design tokens for the Shade Console screen.
//
// Mirrors the Terreno CSS custom properties exported alongside the
// "Shade Console" Claude Design project (terreno/tokens/*.css). The console
// design expresses colors as `var(--token)` strings; `v()` resolves those
// strings to literal values so the ported view-model logic can stay close to
// the original markup.

import {Platform} from "react-native";

// --- Primitive + semantic color map (CSS custom property name -> value) -----
const RAW: Record<string, string> = {
  // Accent — warm gold / honey
  "--accent-000": "#FFFDF7",
  "--accent-050": "#FCECC2",
  "--accent-100": "#F9E0A1",
  "--accent-200": "#F7D582",
  "--accent-300": "#F2CB62",
  "--accent-400": "#E5B132",
  "--accent-500": "#D69C0E",
  "--accent-600": "#B58201",
  "--accent-700": "#956A00",
  "--accent-800": "#543C00",
  "--accent-900": "#332400",

  // Primary — bright cyan-blue
  "--primary-000": "#EBFAFF",
  "--primary-050": "#BCE9F7",
  "--primary-100": "#90D8F0",
  "--primary-200": "#73CAE8",
  "--primary-300": "#40B8E0",
  "--primary-400": "#0E9DCD",
  "--primary-500": "#0086B3",
  "--primary-600": "#0A7092",
  "--primary-700": "#035D7E",
  "--primary-800": "#004B64",
  "--primary-900": "#013749",

  // Secondary — deep teal / slate
  "--secondary-000": "#F2F9FA",
  "--secondary-050": "#D7E5EA",
  "--secondary-100": "#B6CDD5",
  "--secondary-200": "#9EB7BF",
  "--secondary-300": "#87A1AA",
  "--secondary-400": "#608997",
  "--secondary-500": "#2B6072",
  "--secondary-600": "#1C4E5F",
  "--secondary-700": "#0F3D4D",
  "--secondary-800": "#092E3A",
  "--secondary-900": "#041E27",

  // Neutral
  "--neutral-000": "#FFFFFF",
  "--neutral-050": "#F2F2F2",
  "--neutral-100": "#E6E6E6",
  "--neutral-200": "#D9D9D9",
  "--neutral-300": "#CDCDCD",
  "--neutral-400": "#B3B3B3",
  "--neutral-500": "#9A9A9A",
  "--neutral-600": "#686868",
  "--neutral-700": "#4E4E4E",
  "--neutral-800": "#353535",
  "--neutral-900": "#1C1C1C",

  // Status families
  "--success-000": "#DCF2E2",
  "--success-100": "#3EA45C",
  "--success-200": "#1A7F36",
  "--warning-000": "#FFE3C6",
  "--warning-100": "#F36719",
  "--warning-200": "#B14202",
  "--error-000": "#FDD7D7",
  "--error-100": "#D33232",
  "--error-200": "#BD1111",

  // Semantic — surface
  "--surface-base": "#FFFFFF",
  "--surface-primary": "#0E9DCD",
  "--surface-secondary-light": "#B6CDD5",
  "--surface-secondary-dark": "#2B6072",
  "--surface-secondary-extra-dark": "#092E3A",
  "--surface-neutral": "#686868",
  "--surface-neutral-light": "#D9D9D9",
  "--surface-neutral-dark": "#353535",
  "--surface-disabled": "#9A9A9A",
  "--surface-success": "#1A7F36",
  "--surface-success-light": "#DCF2E2",
  "--surface-warning": "#F36719",
  "--surface-warning-light": "#FFE3C6",
  "--surface-error": "#BD1111",
  "--surface-error-light": "#FDD7D7",

  // Semantic — text
  "--text-primary": "#1C1C1C",
  "--text-inverted": "#FFFFFF",
  "--text-secondary-dark": "#092E3A",
  "--text-secondary-light": "#686868",
  "--text-extra-light": "#9A9A9A",
  "--text-link": "#0A7092",
  "--text-link-light": "#0E9DCD",
  "--text-accent": "#956A00",
  "--text-success": "#1A7F36",
  "--text-warning": "#B14202",
  "--text-error": "#BD1111",

  // Semantic — border
  "--border-default": "#CDCDCD",
  "--border-dark": "#9A9A9A",
  "--border-hover": "#D9D9D9",
  "--border-focus": "#73CAE8",
  "--border-active-neutral": "#4E4E4E",
  "--border-active-accent": "#D69C0E",
  "--border-error": "#D33232",
  "--border-success": "#3EA45C",
  "--border-warning": "#F36719",

  // Semantic — presence status
  "--status-active": "#3EA45C",
  "--status-away": "#9A9A9A",
  "--status-do-not-disturb": "#D33232",
};

/**
 * Resolve a design color expression. Accepts either a literal color
 * (`#FF5F57`, `rgba(...)`, `transparent`) or a `var(--token)` string and
 * returns a value React Native can consume.
 */
export const v = (input?: string): string | undefined => {
  if (!input) {
    return undefined;
  }
  if (input.startsWith("var(")) {
    const name = input.slice(4, -1).trim();
    return RAW[name] ?? "#000000";
  }
  return input;
};

// --- Radius (ROUNDING_MAP) --------------------------------------------------
export const radius = {
  sm: 2,
  md: 4,
  lg: 16,
  rounded: 999, // pill — design uses --radius-rounded (360px)
  circle: 9999,
} as const;

// --- Typography -------------------------------------------------------------
// The console's bespoke families (Titillium Web / Nunito) are not bundled in
// this app; on web the CSS stack falls back gracefully, on native we use the
// system font. SpaceMono is bundled and used for monospace runs.
export const fonts = {
  heading: Platform.select({
    web: '"Titillium Web", "Segoe UI", system-ui, sans-serif',
    default: undefined,
  }),
  body: Platform.select({
    web: '"Nunito", system-ui, -apple-system, sans-serif',
    default: undefined,
  }),
  mono: "SpaceMono",
} as const;

// --- Elevation --------------------------------------------------------------
// Terreno's signature hard offset shadow + a softer floating variant.
export const shadowCard = {
  shadowColor: "#999999",
  shadowOffset: {width: 2, height: 2},
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 2,
} as const;

export const shadowFloating = {
  shadowColor: "#1C1C1C",
  shadowOffset: {width: 0, height: 4},
  shadowOpacity: 0.18,
  shadowRadius: 12,
  elevation: 8,
} as const;
