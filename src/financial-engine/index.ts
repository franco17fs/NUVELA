/**
 * Motor financiero de NUVELA.
 *
 * Punto de entrada único. Toda fórmula financiera del sistema vive acá adentro:
 * ningún componente React, ninguna ruta de API y ninguna consulta calcula
 * márgenes, reservas o proyecciones por su cuenta (§40 del brief).
 *
 * El módulo es PURO: sin base de datos, sin red, sin React. Eso permite testear
 * cada fórmula de forma aislada y determinística.
 */

export * from "./types";
export * from "./order-profitability";
export * from "./margins";
export * from "./inventory";
export * from "./cash";
export * from "./daily-reserve";
export * from "./cashflow";
export * from "./consolidation";
export * from "./forecast";
export * from "./alerts";
