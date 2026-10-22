import type { Config } from "tailwindcss";
import defaultColors from "tailwindcss/colors";
import plugin from "tailwindcss/plugin";

/*
 * Three themes, picked per user in /settings → General (users.uiPrefs.theme, applied as
 * <html data-theme="…">). The pages use plain slate / white / tinted utility classes, so the
 * themes are applied here instead of in every file — every colour is a CSS variable:
 * - "blue" (default): dark navy. "dark": neutral charcoal. "light": the stock Tailwind palette.
 * - In the dark themes `slate` is inverted (slate-50 = page background … slate-900 = brightest
 *   text), so "text-slate-900" still means "strongest text" and "bg-slate-100" "subtle hover".
 * - `bg-white` (cards, inputs, menus) = the theme's card colour; text-white stays white.
 * - Tinted colours (red, emerald, sky, …) in the dark themes: 50–300 become dark tints for
 *   badge / alert backgrounds and borders, 700–900 light shades for the text on them.
 * - `brand` (teal) = primary buttons and selected toggles.
 * - The sidebar is always dark: in the light theme it carries data-theme="blue".
 */
type Shades = Record<string, string>;
const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const TINTED = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky",
  "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
] as const;

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** `color` mixed onto `base` at `weight` (0–1), as hex. */
function mix(color: string, base: string, weight: number): string {
  const [a, b] = [rgb(color), rgb(base)];
  return (
    "#" +
    a.map((v, i) => Math.round(v * weight + b[i] * (1 - weight)).toString(16).padStart(2, "0")).join("")
  );
}

function darkTint(c: Shades, base: string): Shades {
  return {
    ...c,
    50: mix(c[500], base, 0.14),
    100: mix(c[500], base, 0.22),
    200: mix(c[500], base, 0.38),
    300: mix(c[500], base, 0.55),
    600: c[500],
    700: c[300],
    800: c[200],
    900: c[100],
    950: c[50],
  };
}

interface Theme {
  dark: boolean;
  slate: Shades;
  /** Page background. */
  bg: string;
  /** Cards, inputs, menus (`bg-white`). */
  card: string;
  sidebar: { bg: string; fg: string; primary: string; accent: string; border: string };
}

const NAVY_SIDEBAR = {
  bg: "#081936",
  fg: "#c4d1e8",
  primary: "#17407f",
  accent: "#15336a",
  border: "#1a3466",
};

const THEMES: Record<"blue" | "dark" | "light", Theme> = {
  blue: {
    dark: true,
    slate: {
      50: "#0a1f44", 100: "#15336a", 200: "#1f3d73", 300: "#2c4c85", 400: "#6c84ad",
      500: "#8ea3c7", 600: "#a9bad8", 700: "#c4d1e8", 800: "#dbe4f3", 900: "#f1f5fb",
      950: "#ffffff",
    },
    bg: "#0a1f44",
    card: "#0f2a5a",
    sidebar: NAVY_SIDEBAR,
  },
  dark: {
    dark: true,
    slate: {
      50: "#0d1117", 100: "#1b222c", 200: "#262e39", 300: "#343d4a", 400: "#6e7681",
      500: "#8b949e", 600: "#a5aeb8", 700: "#c9d1d9", 800: "#dde3ea", 900: "#f0f3f6",
      950: "#ffffff",
    },
    bg: "#0d1117",
    card: "#151b23",
    sidebar: { bg: "#090c10", fg: "#c9d1d9", primary: "#262e39", accent: "#1b222c", border: "#1f2630" },
  },
  light: {
    dark: false,
    slate: defaultColors.slate as Shades,
    bg: "#f1f5f9",
    card: "#ffffff",
    sidebar: NAVY_SIDEBAR, // the sidebar itself is rendered with the blue theme
  },
};

const channels = (hex: string) => rgb(hex).join(" ");

/** The CSS variables of one theme. */
function themeVars(t: Theme): Record<string, string> {
  const s = t.slate;
  const vars: Record<string, string> = { "color-scheme": t.dark ? "dark" : "light" };
  for (const k of SHADES) vars[`--c-slate-${k}`] = channels(s[k]);
  for (const name of TINTED) {
    const base = defaultColors[name] as Shades;
    const c = t.dark ? darkTint(base, t.bg) : base;
    for (const k of SHADES) vars[`--c-${name}-${k}`] = channels(c[k]);
  }
  return Object.assign(vars, {
    "--c-bg": channels(t.bg),
    "--c-card": channels(t.card),
    "--c-sidebar": channels(t.sidebar.bg),
    "--background": t.bg,
    "--foreground": s[900],
    "--card": t.card,
    "--card-foreground": s[900],
    "--popover": t.card,
    "--popover-foreground": s[900],
    "--primary": "#14b8a6",
    "--primary-foreground": "#ffffff",
    "--secondary": s[100],
    "--secondary-foreground": s[900],
    "--muted": s[100],
    "--muted-foreground": s[500],
    "--accent": s[100],
    "--accent-foreground": s[900],
    "--destructive": "#ef4444",
    "--destructive-foreground": "#ffffff",
    "--border": s[200],
    "--input": s[300],
    "--ring": "#2dd4bf",
    "--chart-1": "#ef4444",
    "--chart-2": "#f59e0b",
    "--chart-3": s[500],
    "--chart-4": "#14b8a6",
    "--chart-5": "#38bdf8",
    "--radius": "0.5rem",
    "--sidebar": t.sidebar.bg,
    "--sidebar-foreground": t.sidebar.fg,
    "--sidebar-primary": t.sidebar.primary,
    "--sidebar-primary-foreground": "#ffffff",
    "--sidebar-accent": t.sidebar.accent,
    "--sidebar-accent-foreground": "#ffffff",
    "--sidebar-border": t.sidebar.border,
    "--sidebar-ring": "#2dd4bf",
  });
}

const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;
const shadesOf = (name: string) => Object.fromEntries(SHADES.map((k) => [k, v(`${name}-${k}`)]));
const slate = shadesOf("slate");

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
        ...Object.fromEntries(TINTED.map((name) => [name, shadesOf(name)])),
        slate,
        gray: slate,
        brand: {
          DEFAULT: "#14b8a6",
          hover: "#0d9488",
          foreground: "#ffffff",
        },
        navy: { DEFAULT: v("bg"), card: v("card"), sidebar: v("sidebar") },
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
      backgroundColor: { white: v("card") },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    plugin(({ addBase }) => {
      addBase({
        ':root, [data-theme="blue"]': themeVars(THEMES.blue),
        '[data-theme="dark"]': themeVars(THEMES.dark),
        '[data-theme="light"]': themeVars(THEMES.light),
      });
    }),
  ],
};
export default config;
