import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14171f",
        muted: "#5f6673",
        faint: "#9aa1ad",
        line: "#e7e9ef",
        canvas: "#f6f7f9",
        brand: "#2f6fed",
        "brand-soft": "#eef2ff",
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
        "3xl": "20px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.03)",
        lift: "0 4px 16px rgba(16,24,40,.07)",
        composer: "0 2px 10px rgba(16,24,40,.06), 0 1px 2px rgba(16,24,40,.04)",
      },
      maxWidth: {
        prose: "68ch",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up .28s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
