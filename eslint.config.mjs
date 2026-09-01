import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * `eslint-config-next` 16 ya publica configuraciones flat nativas, así que se
 * importan directamente en vez de envolverlas con FlatCompat.
 */
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "prisma/migrations/**",
      // Bridge estático de OAuth publicado en GitHub Pages: no forma parte de la
      // app Next y corre en un navegador sin bundler.
      "callback.js",
    ],
  },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
