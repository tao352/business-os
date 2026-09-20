import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./features/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#F7F7F5",
        surface: {
          DEFAULT: "#FFFFFF",
          subtle: "#FAFAF9",
          muted: "#F1F1EF",
        },
        ink: {
          DEFAULT: "#18181B",
          secondary: "#52525B",
          muted: "#71717A",
          faint: "#A1A1AA",
        },
        accent: {
          DEFAULT: "#2563EB",
          hover: "#1D4ED8",
          subtle: "#EFF6FF",
        },
        sidebar: {
          DEFAULT: "#18181B",
          border: "#27272A",
          text: "#A1A1AA",
          active: "#FFFFFF",
          hover: "#27272A",
          highlight: "#2563EB",
        },
        line: {
          DEFAULT: "#E4E4E7",
          subtle: "#F4F4F5",
          strong: "#D4D4D8",
        },
      },
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "10px",
        xl: "12px",
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "14px" }],
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "18px" }],
        base: ["14px", { lineHeight: "20px" }],
        md: ["15px", { lineHeight: "22px" }],
        lg: ["17px", { lineHeight: "24px" }],
        xl: ["20px", { lineHeight: "28px" }],
        "2xl": ["24px", { lineHeight: "32px" }],
      },
    },
  },
  plugins: [],
};

export default config;
