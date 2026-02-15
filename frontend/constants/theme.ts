// Theme configuration for the app
// Override these values to customize the app's appearance
// Colors are based on @terreno/ui's default theme primitives

export const primitives = {
  // Primary colors (teal/cyan)
  primary000: "#EBFAFF",
  primary050: "#BCE9F7",
  primary100: "#90D8F0",
  primary200: "#73CAE8",
  primary300: "#40B8E0",
  primary400: "#0E9DCD",
  primary500: "#0086B3",
  primary600: "#0A7092",
  primary700: "#035D7E",
  primary800: "#004B64",
  primary900: "#013749",

  // Secondary colors (dark teal)
  secondary000: "#F2F9FA",
  secondary050: "#D7E5EA",
  secondary100: "#B6CDD5",
  secondary200: "#9EB7BF",
  secondary300: "#87A1AA",
  secondary400: "#608997",
  secondary500: "#2B6072",
  secondary600: "#1C4E5F",
  secondary700: "#0F3D4D",
  secondary800: "#092E3A",
  secondary900: "#041E27",

  // Accent colors (gold/yellow)
  accent000: "#FFFDF7",
  accent050: "#FCECC2",
  accent100: "#F9E0A1",
  accent200: "#F7D582",
  accent300: "#F2CB62",
  accent400: "#E5B132",
  accent500: "#D69C0E",
  accent600: "#B58201",
  accent700: "#956A00",
  accent800: "#543C00",
  accent900: "#332400",

  // Neutral colors (grays)
  neutral000: "#FFFFFF",
  neutral050: "#F2F2F2",
  neutral100: "#E6E6E6",
  neutral200: "#D9D9D9",
  neutral300: "#CDCDCD",
  neutral400: "#B3B3B3",
  neutral500: "#9A9A9A",
  neutral600: "#686868",
  neutral700: "#4E4E4E",
  neutral800: "#353535",
  neutral900: "#1C1C1C",

  // Status colors
  error000: "#FDD7D7",
  error100: "#D33232",
  error200: "#BD1111",
  success000: "#DCF2E2",
  success100: "#3EA45C",
  success200: "#1A7F36",
  warning000: "#FFE3C6",
  warning100: "#F36719",
  warning200: "#B14202",
};

// Semantic color mappings - override these to change app appearance
export const colors = {
  // Backgrounds
  background: primitives.neutral000,
  backgroundSecondary: primitives.neutral050,

  // Text
  text: primitives.neutral900,
  textSecondary: primitives.neutral600,
  textInverted: primitives.neutral000,

  // Primary action colors
  primary: primitives.primary400,
  primaryDark: primitives.primary600,
  primaryLight: primitives.primary100,

  // Secondary colors
  secondary: primitives.secondary500,
  secondaryDark: primitives.secondary700,
  secondaryLight: primitives.secondary100,

  // Accent colors
  accent: primitives.accent500,
  accentDark: primitives.accent700,
  accentLight: primitives.accent100,

  // Status colors
  error: primitives.error100,
  errorLight: primitives.error000,
  success: primitives.success100,
  successLight: primitives.success000,
  warning: primitives.warning100,
  warningLight: primitives.warning000,

  // UI elements
  border: primitives.neutral300,
  borderFocus: primitives.primary200,
  icon: primitives.neutral600,
  tint: primitives.primary400,

  // Tab bar
  tabIconDefault: primitives.neutral600,
  tabIconSelected: primitives.primary400,
};
