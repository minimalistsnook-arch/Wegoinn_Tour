import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  root: 'wegoinn',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
  },
})
