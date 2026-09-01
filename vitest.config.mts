import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` es un guard de Next: lanza si un módulo de servidor se
      // importa desde un componente de cliente. Fuera de Next no hay tal
      // distinción, así que en los tests se resuelve a un módulo vacío. Esto
      // permite testear las funciones puras de las integraciones (parsers,
      // backoff, filtros) sin levantar Next ni tocar la red.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // El motor financiero es puro: no necesita base de datos ni red.
    // Cualquier test que sí las necesite debe vivir fuera de esta suite.
    globals: false,
  },
});
