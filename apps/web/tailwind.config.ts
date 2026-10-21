import type { Config } from "tailwindcss";
import defaultColors from "tailwindcss/colors";

/*
 * Dark navy theme. The pages use plain slate / white / tinted utility classes, so the theme is
 * applied here instead of in every file:
 * - `slate` is inverted (slate-50 = page background … slate-900 = brightest text), so
 *   "text-slate-900" still means "strongest text" and "bg-slate-100" "subtle hover".
 * - `bg-white` (cards, inputs, menus) = the navy card colour; text-white stays white.
 * - Tinted colours (red, emerald, sky, …): 50–300 become dark tints for badge / alert
 *   backgrounds and borders, 700–900 light shades for the text on them.
 * - `brand` (teal) = primary buttons and selected toggles.
 */
const NAVY = "#0a1f44";
const CARD = "#0f2a5a";

const slate = {
  50: NAVY,
  100: "#15336a",
  200: "#1f3d73",
  300: "#2c4c85",
  400: "#6c84ad",
  500: "#8ea3c7",
  600: "#a9bad8",
  700: "#c4d1e8",
  800: "#dbe4f3",
  900: "#f1f5fb",
  950: "#ffffff",
};

/** `color` mixed onto the navy background at `weight` (0–1), as hex. */
function mix(color: string, weight: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [rgb(color), rgb(NAVY)];
  return (
    "#" +
    a.map((v, i) => Math.round(v * weight + b[i] * (1 - weight)).toString(16).padStart(2, "0")).join("")
  );
}

function darkTint(c: Record<string, string>) {
  return {
    ...c,
    50: mix(c[500], 0.14),
    100: mix(c[500], 0.22),
    200: mix(c[500], 0.38),
    300: mix(c[500], 0.55),
    600: c[500],
    700: c[300],
    800: c[200],
    900: c[100],
    950: c[50],
  };
}

const TINTED = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky",
  "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
] as const;
const tinted = Object.fromEntries(
  TINTED.map((name) => [name, darkTint(defaultColors[name] as Record<string, string>)]),
);

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "Segoe UI", "Arial", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "Consolas", "monospace"],
      },
      colors: {
        ...tinted,
        slate,
        gray: slate,
        brand: {
          DEFAULT: "#14b8a6",
          hover: "#0d9488",
          foreground: "#ffffff",
        },
        navy: { DEFAULT: NAVY, card: CARD, sidebar: "#081936" },
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
      },
      backgroundColor: { white: CARD },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
