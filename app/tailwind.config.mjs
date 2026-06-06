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
      borderRadius: {
        xl2: "1.25rem",
        pill: "9999px",
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
