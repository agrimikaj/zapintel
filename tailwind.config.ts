import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#0A0F1E",
          surface: "#111827",
          elevated: "#1A2235",
          input: "#0F1929",
        },
        accent: {
          cyan: "#00D4FF",
          cyanMuted: "#0A4F5E",
          amber: "#FFB800",
          amberMuted: "#4A3500",
          emerald: "#00C47A",
          emeraldMuted: "#003D28",
          red: "#FF4D4D",
          redMuted: "#3D0000",
        },
        ink: {
          primary: "#F0F4FF",
          secondary: "#8892A4",
          tertiary: "#4A5568",
        },
        edge: {
          default: "#1E2D45",
          active: "#2D4A6B",
        },
      },
      fontFamily: {
        display: ["'Bebas Neue'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
        body: ["'DM Sans'", "sans-serif"],
      },
      fontSize: {
        threat: ["64px", { lineHeight: "1" }],
        hero: ["48px", { lineHeight: "1.1" }],
        section: ["13px", { lineHeight: "1.2", letterSpacing: "0.08em" }],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
