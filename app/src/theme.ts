// JCut.AI theme engine.
//
// Two independent axes drive the entire look:
//   1. MODE   — the background "mood" / surface palette (dark, light, midnight…).
//   2. ACCENT — the brand color that paints buttons, toggles, active states,
//               glows, and a subtle tint in the background gradient.
//
// Both write CSS custom properties on :root, so every component styled with
// `var(--accent…)` / Tailwind's `accent` color updates instantly and live —
// no per-component wiring. The accent gradient is exposed as a CSS variable
// (`--accent-grad`), and TEAL_GRADIENT / BLUE_GRADIENT resolve to that variable
// so the ~20 existing call sites follow the chosen accent automatically.

export const BRAND = {
  teal:     "#23C6A2",
  tealDeep: "#15BC9C",
  blue:     "#034EA6",
  blueGlow: "#2E6BE6",
};

// Live, accent-following gradients. These point at CSS variables set by
// applyTheme(), so existing `style={{ background: TEAL_GRADIENT }}` usages now
// track whatever accent the user picked. BLUE_GRADIENT stays a fixed secondary
// (used for the alternate timeline-clip / project-tile color).
export const TEAL_GRADIENT = "var(--accent-grad)";
export const BLUE_GRADIENT  = "var(--accent-grad-alt)";

export const spring = {
  soft:   { type: "spring", stiffness: 260, damping: 26, mass: 0.9 } as const,
  snappy: { type: "spring", stiffness: 420, damping: 30, mass: 0.7 } as const,
  bouncy: { type: "spring", stiffness: 500, damping: 18, mass: 0.8 } as const,
};

// ─── Accent palette ──────────────────────────────────────────────────────────
// Each accent supplies: base (primary hue), deep (gradient end / pressed),
// glow (rgb triple for ambient glows + bg tint), and a contrasting secondary
// used for the alternate gradient.

export type Accent =
  | "teal" | "ocean" | "indigo" | "violet" | "magenta"
  | "rose" | "amber" | "emerald" | "lime" | "crimson"
  | "cyan" | "slate";

interface AccentDef {
  label: string;
  base: string;
  deep: string;
  glow: string;   // "r, g, b" — used in rgba() for glows + background tint
  alt: string;    // secondary gradient end (for BLUE_GRADIENT)
  altBase: string;
}

export const ACCENTS: Record<Accent, AccentDef> = {
  teal:    { label: "Teal",    base: "#23C6A2", deep: "#12A98C", glow: "46, 198, 162",  altBase: "#2E6BE6", alt: "#034EA6" },
  ocean:   { label: "Ocean",   base: "#2E6BE6", deep: "#1B4FBF", glow: "46, 107, 230",  altBase: "#23C6A2", alt: "#12A98C" },
  indigo:  { label: "Indigo",  base: "#6366F1", deep: "#4F46E5", glow: "99, 102, 241",  altBase: "#22D3EE", alt: "#0E9CB8" },
  violet:  { label: "Violet",  base: "#8B5CF6", deep: "#7C3AED", glow: "139, 92, 246",  altBase: "#EC4899", alt: "#BE185D" },
  magenta: { label: "Magenta", base: "#D946EF", deep: "#A21CAF", glow: "217, 70, 239",  altBase: "#8B5CF6", alt: "#6D28D9" },
  rose:    { label: "Rose",    base: "#FB7185", deep: "#E11D48", glow: "251, 113, 133", altBase: "#FB923C", alt: "#EA580C" },
  amber:   { label: "Amber",   base: "#FBBF24", deep: "#D97706", glow: "251, 191, 36",  altBase: "#F87171", alt: "#DC2626" },
  emerald: { label: "Emerald", base: "#34D399", deep: "#059669", glow: "52, 211, 153",  altBase: "#22D3EE", alt: "#0891B2" },
  lime:    { label: "Lime",    base: "#A3E635", deep: "#65A30D", glow: "163, 230, 53",  altBase: "#34D399", alt: "#059669" },
  crimson: { label: "Crimson", base: "#F43F5E", deep: "#BE123C", glow: "244, 63, 94",   altBase: "#FB923C", alt: "#C2410C" },
  cyan:    { label: "Cyan",    base: "#22D3EE", deep: "#0891B2", glow: "34, 211, 238",   altBase: "#2E6BE6", alt: "#1B4FBF" },
  slate:   { label: "Steel",   base: "#94A3B8", deep: "#64748B", glow: "148, 163, 184", altBase: "#7C8BA8", alt: "#566076" },
};

export const ACCENT_ORDER: Accent[] = [
  "teal", "ocean", "cyan", "emerald", "lime",
  "indigo", "violet", "magenta", "rose", "crimson", "amber", "slate",
];

export const DEFAULT_ACCENT: Accent = "teal";

export function isAccent(x: unknown): x is Accent {
  return typeof x === "string" && x in ACCENTS;
}

// ─── Modes (background / surface palette only — accent comes separately) ──────

export type Mode = "dark" | "light" | "midnight" | "forest" | "warm" | "slate";

export const THEME_META: Record<Mode, { label: string; swatch: string }> = {
  dark:     { label: "Dark",     swatch: "#0D0D0F" },
  light:    { label: "Light",    swatch: "#F6F7F9" },
  midnight: { label: "Midnight", swatch: "#0A0E1A" },
  forest:   { label: "Forest",   swatch: "#0B120D" },
  warm:     { label: "Warm",     swatch: "#13100C" },
  slate:    { label: "Slate",    swatch: "#0E1117" },
};

// Per-mode surface palette. Note: --accent / --accent-blue / --glow / --bg-grad
// are now OWNED by the accent layer (applyAccent), so they're omitted here.
export const THEMES: Record<Mode, Record<string, string>> = {
  dark: {
    "--bg":           "#0D0D0F",
    "--surface":      "#17181D",
    "--surface-2":    "#1F2128",
    "--border":       "rgba(255,255,255,0.05)",
    "--text":         "#F4F5F7",
    "--text-dim":     "#9BA0AA",
    "--shadow":       "0 12px 40px rgba(0,0,0,0.55)",
    "--card-grad":    "linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
    "--card-grad-hover": "linear-gradient(145deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
  },
  light: {
    "--bg":           "#EDEEF2",
    "--surface":      "#FAFBFC",
    "--surface-2":    "#E4E7EE",
    "--border":       "rgba(0,0,0,0.06)",
    "--text":         "#14161C",
    "--text-dim":     "#555B6A",
    "--shadow":       "0 8px 32px rgba(20,30,60,0.09)",
    "--card-grad":    "linear-gradient(145deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.6) 100%)",
    "--card-grad-hover": "linear-gradient(145deg, #ffffff 0%, rgba(255,255,255,0.8) 100%)",
  },
  midnight: {
    "--bg":           "#07090F",
    "--surface":      "#0D1220",
    "--surface-2":    "#141A2C",
    "--border":       "rgba(80,110,220,0.08)",
    "--text":         "#E8EDF8",
    "--text-dim":     "#6272A4",
    "--shadow":       "0 12px 48px rgba(0,0,0,0.75)",
    "--card-grad":    "linear-gradient(145deg, rgba(90,120,255,0.06) 0%, rgba(40,60,180,0.02) 100%)",
    "--card-grad-hover": "linear-gradient(145deg, rgba(90,120,255,0.10) 0%, rgba(40,60,180,0.04) 100%)",
  },
  forest: {
    "--bg":           "#070D08",
    "--surface":      "#0C1610",
    "--surface-2":    "#121F17",
    "--border":       "rgba(60,160,80,0.07)",
    "--text":         "#E0EDE2",
    "--text-dim":     "#5E8A68",
    "--shadow":       "0 12px 48px rgba(0,0,0,0.68)",
    "--card-grad":    "linear-gradient(145deg, rgba(50,160,80,0.06) 0%, rgba(20,80,40,0.02) 100%)",
    "--card-grad-hover": "linear-gradient(145deg, rgba(50,160,80,0.10) 0%, rgba(20,80,40,0.04) 100%)",
  },
  warm: {
    "--bg":           "#0F0C09",
    "--surface":      "#181410",
    "--surface-2":    "#221B14",
    "--border":       "rgba(200,150,70,0.07)",
    "--text":         "#F2EAE0",
    "--text-dim":     "#8A7060",
    "--shadow":       "0 12px 48px rgba(0,0,0,0.68)",
    "--card-grad":    "linear-gradient(145deg, rgba(200,140,60,0.07) 0%, rgba(120,70,20,0.02) 100%)",
    "--card-grad-hover": "linear-gradient(145deg, rgba(200,140,60,0.11) 0%, rgba(120,70,20,0.04) 100%)",
  },
  slate: {
    "--bg":           "#0B0D11",
    "--surface":      "#12151C",
    "--surface-2":    "#191D28",
    "--border":       "rgba(160,180,220,0.06)",
    "--text":         "#E4E7F0",
    "--text-dim":     "#72809A",
    "--shadow":       "0 12px 48px rgba(0,0,0,0.62)",
    "--card-grad":    "linear-gradient(145deg, rgba(140,160,220,0.06) 0%, rgba(80,100,180,0.02) 100%)",
    "--card-grad-hover": "linear-gradient(145deg, rgba(140,160,220,0.10) 0%, rgba(80,100,180,0.04) 100%)",
  },
};

// How dark the page sits behind the radial accent-tinted glow, per mode. Light
// mode needs a near-white floor; everything else uses its own --bg.
const BG_FLOOR: Record<Mode, string> = {
  dark: "#0D0D0F", light: "#EDEEF2", midnight: "#07090F",
  forest: "#070D08", warm: "#0F0C09", slate: "#0B0D11",
};

// ─── Application ─────────────────────────────────────────────────────────────

export function applyAccent(accent: Accent, mode: Mode) {
  const a = ACCENTS[accent] ?? ACCENTS[DEFAULT_ACCENT];
  const root = document.documentElement;
  const tintAlpha = mode === "light" ? 0.10 : 0.16;

  const vars: Record<string, string> = {
    "--accent":          a.base,
    "--accent-deep":     a.deep,
    "--accent-blue":     a.altBase,
    "--accent-glow-rgb": a.glow,
    "--accent-grad":     `linear-gradient(135deg, ${a.base} 0%, ${a.deep} 100%)`,
    "--accent-grad-alt": `linear-gradient(135deg, ${a.altBase} 0%, ${a.alt} 100%)`,
    "--glow":            `0 0 60px rgba(${a.glow}, 0.28)`,
    // Background = a soft radial wash of the accent over the mode's floor color.
    "--bg-grad":         `radial-gradient(125% 80% at 50% 118%, rgba(${a.glow}, ${tintAlpha}) 0%, ${BG_FLOOR[mode]} 58%)`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.setAttribute("data-accent", accent);
}

// ─── Display & feel customization ────────────────────────────────────────────
// Independent of color theme: density, text size, corner roundness, UI font,
// motion, and film grain. All drive CSS variables (see index.css), so they
// apply app-wide with no per-component wiring.

export type Density = "compact" | "comfortable" | "spacious";
export type FontScale = "small" | "default" | "large";
export type Radius = "sharp" | "default" | "round";
export type UiFont = "system" | "inter" | "rounded" | "mono";

export interface DisplaySettings {
  density: Density;
  fontScale: FontScale;
  radius: Radius;
  uiFont: UiFont;
  reduceMotion: boolean;
  grain: boolean;
}

export const DISPLAY_DEFAULTS: DisplaySettings = {
  density: "comfortable",
  fontScale: "default",
  radius: "default",
  uiFont: "system",
  reduceMotion: false,
  grain: true,
};

export const DENSITY_META: Record<Density, { label: string; mul: number }> = {
  compact:     { label: "Compact",     mul: 0.92 },
  comfortable: { label: "Comfortable", mul: 1 },
  spacious:    { label: "Spacious",    mul: 1.08 },
};

export const FONT_SCALE_META: Record<FontScale, { label: string; mul: number }> = {
  small:   { label: "Small",   mul: 0.94 },
  default: { label: "Default", mul: 1 },
  large:   { label: "Large",   mul: 1.1 },
};

export const RADIUS_META: Record<Radius, { label: string; scale: number }> = {
  sharp:   { label: "Sharp",   scale: 0.45 },
  default: { label: "Default", scale: 1 },
  round:   { label: "Round",   scale: 1.6 },
};

export const UI_FONT_META: Record<UiFont, { label: string; stack: string }> = {
  system:  { label: "System",  stack: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif" },
  inter:   { label: "Inter",   stack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  rounded: { label: "Rounded", stack: "'SF Pro Rounded', 'Nunito', 'Quicksand', ui-rounded, -apple-system, sans-serif" },
  mono:    { label: "Mono",    stack: "'SF Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, 'Menlo', monospace" },
};

export function normalizeDisplay(raw: Partial<DisplaySettings> | undefined | null): DisplaySettings {
  const d = { ...DISPLAY_DEFAULTS, ...(raw || {}) };
  if (!(d.density in DENSITY_META)) d.density = DISPLAY_DEFAULTS.density;
  if (!(d.fontScale in FONT_SCALE_META)) d.fontScale = DISPLAY_DEFAULTS.fontScale;
  if (!(d.radius in RADIUS_META)) d.radius = DISPLAY_DEFAULTS.radius;
  if (!(d.uiFont in UI_FONT_META)) d.uiFont = DISPLAY_DEFAULTS.uiFont;
  d.reduceMotion = !!d.reduceMotion;
  d.grain = d.grain !== false;
  return d;
}

export function applyDisplay(raw: Partial<DisplaySettings> | undefined | null) {
  const d = normalizeDisplay(raw);
  const root = document.documentElement;
  root.style.setProperty("--density", String(DENSITY_META[d.density].mul));
  root.style.setProperty("--font-scale", String(FONT_SCALE_META[d.fontScale].mul));
  root.style.setProperty("--radius-scale", String(RADIUS_META[d.radius].scale));
  root.style.setProperty("--ui-font", UI_FONT_META[d.uiFont].stack);
  root.style.setProperty("--grain-opacity", d.grain ? "0.055" : "0");
  root.setAttribute("data-motion", d.reduceMotion ? "reduced" : "full");
}

export function applyTheme(mode: Mode, accent: Accent = DEFAULT_ACCENT) {
  const vars = THEMES[mode] ?? THEMES.dark;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.setAttribute("data-theme", mode);
  // Accent owns --accent*, --glow and --bg-grad, and depends on the mode for its
  // background tint, so it must run after the surface palette is in place.
  applyAccent(accent, mode);
}
