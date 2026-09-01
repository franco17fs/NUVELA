import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // El motor financiero es puro: no necesita base de datos ni red.
    // Cualquier test que la necesite debe vivir fuera de esta suite.
    globals: false,
  },
});
