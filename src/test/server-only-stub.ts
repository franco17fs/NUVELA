/**
 * Reemplazo de `server-only` para la suite de tests.
 *
 * En la aplicación, `server-only` hace fallar el build si un módulo de servidor
 * se importa desde un componente de cliente. Ese guard depende del bundler de
 * Next; bajo Vitest no aplica y además impide importar módulos perfectamente
 * testeables (parsers de CSV, cálculo de backoff, armado de filtros).
 *
 * El alias vive en `vitest.config.mts`. La protección real sigue activa en el
 * build de la aplicación, que es donde importa.
 */
export {};
