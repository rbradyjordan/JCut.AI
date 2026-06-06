// JCut.AI design tokens — sampled from the app icon + Gemini design language.
// Two modes: dark (default) and light. Consumed by Tailwind via CSS variables
// (see index.css) and by Framer Motion spring presets.

export const BRAND = {
  teal: "#23C6A2",      // icon teal clip, bright stop
  tealDeep: "#15BC9C",  // icon teal clip, deep stop
  blue: "#034EA6",      // icon blue clip
  blueGlow: "#2E6BE6",  // Gemini ambient blue
};

// Gradient used on the "teal" accent clip cards / primary actions.
export const TEAL_GRADIENT = `linear-gradient(135deg, ${BRAND.teal} 0%, ${BRAND.tealDeep} 100%)`;
export const BLUE_GRADIENT = `linear-gradient(135deg, ${BRAND.blueGlow} 0%, ${BRAND.blue} 100%)`;

// Spring presets — the "springy" feel. Tuned to be lively but not bouncy-annoying.
export const spring = {
  soft:   { type: "spring", stiffness: 260, damping: 26, mass: 0.9 } as const,
  snappy: { type: "spring", stiffness: 420, damping: 30, mass: 0.7 } as const,
  bouncy: { type: "spring", stiffness: 500, damping: 18, mass: 0.8 } as const,
};

export type Mode = "dark" | "light";

// CSS-variable palettes applied to <html data-theme>.
export const THEMES: Record<Mode, Record<string, string>> = {
  dark: {
    "--bg":          "#0D0D0F",                          // icon black
    "--bg-grad":     "radial-gradient(120% 80% at 50% 120%, #0c1633 0%, #0D0D0F 55%)", // navy glow from bottom (Gemini)
    "--surface":     "#16171B",                          // raised card
    "--surface-2":   "#1E2026",                          // input pill / chips
    "--border":      "rgba(255,255,255,0.08)",
    "--text":        "#F4F5F7",
    "--text-dim":    "#9BA0AA",
    "--accent":      BRAND.teal,
    "--accent-blue": BRAND.blueGlow,
    "--shadow":      "0 12px 40px rgba(0,0,0,0.55)",
    "--glow":        "0 0 60px rgba(46,107,230,0.25)",
  },
  light: {
    "--bg":          "#F6F7F9",
    "--bg-grad":     "radial-gradient(120% 80% at 50% 120%, #e8eefc 0%, #F6F7F9 55%)",
    "--surface":     "#FFFFFF",
    "--surface-2":   "#EEF0F4",
    "--border":      "rgba(0,0,0,0.08)",
    "--text":        "#16181D",
    "--text-dim":    "#5C616B",
    "--accent":      BRAND.tealDeep,
    "--accent-blue": BRAND.blue,
    "--shadow":      "0 12px 40px rgba(20,30,60,0.12)",
    "--glow":        "0 0 60px rgba(46,107,230,0.12)",
  },
};

export function applyTheme(mode: Mode) {
  const vars = THEMES[mode];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.setAttribute("data-theme", mode);
}
