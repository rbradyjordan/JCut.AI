/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        surface2: "var(--surface-2)",
        ink: "var(--text)",
        dim: "var(--text-dim)",
        accent: "var(--accent)",
        accentBlue: "var(--accent-blue)",
        line: "var(--border)",
      },
      boxShadow: {
        card: "var(--shadow)",
        glow: "var(--glow)",
      },
      // Corner radii scale with --radius-scale (set by the Display settings), so
      // "Sharp / Default / Round" retunes the whole app's roundness at once.
      // pill/full stay fully round regardless.
      borderRadius: {
        sm:   "calc(0.125rem * var(--radius-scale))",
        DEFAULT: "calc(0.25rem * var(--radius-scale))",
        md:   "calc(0.375rem * var(--radius-scale))",
        lg:   "calc(0.5rem * var(--radius-scale))",
        xl:   "calc(0.75rem * var(--radius-scale))",
        "2xl": "calc(1rem * var(--radius-scale))",
        "3xl": "calc(1.5rem * var(--radius-scale))",
        xl2:  "calc(1.25rem * var(--radius-scale))",
        pill: "9999px",
        full: "9999px",
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
