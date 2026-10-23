import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1a1d24",
        muted: "#5c6474",
        line: "#e6e9ef",
        brand: "#2f6fed",
      },
    },
  },
  plugins: [],
};

export default config;
