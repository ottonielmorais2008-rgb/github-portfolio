/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/github-portfolio/",
  plugins: [react()],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
