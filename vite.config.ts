import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// cliamp-web: static PWA, zero backend.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
  },
});
