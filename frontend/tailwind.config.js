import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        lmslide: { '0%': { left: '-40%' }, '100%': { left: '100%' } },
      },
      // Bundled with the app (@fontsource): the CSP allows fonts only from 'self'.
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', '"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Lemon readable as text (olive on light surfaces, lemon on dark ones), meters, tints.
        ink: "hsl(var(--ink))",
        line: "hsl(var(--line))",
        soft: {
          DEFAULT: "hsl(var(--soft))",
          strong: "hsl(var(--soft-strong))",
        },
        ok: "hsl(var(--ok))",
        warn: "hsl(var(--warn))",
        "ram-other": "hsl(var(--ram-other))",
        rail: {
          DEFAULT: "hsl(var(--rail))",
          foreground: "hsl(var(--rail-foreground))",
          muted: "hsl(var(--rail-muted))",
          active: "hsl(var(--rail-active))",
          "active-foreground": "hsl(var(--rail-active-foreground))",
          border: "hsl(var(--rail-border))",
        },
        // Cyber-citrus lab tokens
        citrus: {
          50: "#fdffe5",
          100: "#faffc5",
          200: "#f4ff90",
          300: "#e9ff4f",
          400: "#dffe00",
          500: "#c7e300",
          600: "#9cb600",
          700: "#748800",
          800: "#5a6907",
          900: "#4b570b",
        },
        carbon: {
          850: "#13161f",
          900: "#0e1017",
          950: "#08090d",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        // Flat design: the old tactile shadows are kept as names but are now plain and quiet.
        'tactile': 'none',
        'tactile-light': 'none',
        'pop': '0 24px 60px -12px rgba(15, 17, 8, 0.28)',
        'neon-lemon': 'none',
        'beacon': '0 0 10px 1px rgba(16, 185, 129, 0.4)',
      },
    },
  },
  plugins: [animate],
};
