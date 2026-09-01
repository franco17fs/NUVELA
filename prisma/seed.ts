import { PrismaClient } from "@prisma/client";

/**
 * Datos iniciales.
 *
 * Sólo se siembran cosas que son configuración, no datos de negocio: categorías
 * de gastos, reglas comerciales de referencia y parámetros por defecto. **No se
 * crean ventas, cuentas ni saldos ficticios**: el brief lo prohíbe explícitamente
 * y una base con datos de ejemplo que parecen reales es peor que una vacía.
 *
 * Es idempotente: se puede correr las veces que haga falta.
 */
const prisma = new PrismaClient();

/** Categorías del §16 del brief. El usuario puede agregar las suyas. */
const EXPENSE_CATEGORIES = [
  "Mercadería",
  "Logística externa",
  "Publicidad externa",
  "Sueldos",
  "Honorarios",
  "Impuestos",
  "Servicios",
  "Alquiler",
  "Software",
  "Embalaje",
  "Transporte",
  "Tarjetas",
  "Préstamos",
  "Otros",
];

const INCOME_CATEGORIES = [
  "Ventas fuera de Mercado Libre",
  "Reintegros",
  "Aportes de socios",
  "Intereses",
  "Otros",
];

/**
 * Reglas comerciales de referencia (§8 del brief).
 *
 * IMPORTANTE: estos valores son **fallback y motor de simulación**, no la verdad.
 * Cuando Mercado Libre informa el cargo real de una venta —vía
 * `order_items[].sale_fee`— ese dato manda siempre. Estas reglas se usan para
 * simular precios, proyectar y alertar sobre productos que todavía no vendieron.
 *
 * Están versionadas por vigencia: cambiar un porcentaje es editar una fila, no
 * tocar código ni volver a desplegar.
 */
const COMMERCIAL_RULES = [
  {
    ruleType: "SALE_FEE_PERCENTAGE" as const,
    name: "Comisión por vender — rango de referencia MLA",
    values: {
      minPercentage: "11.62",
      maxPercentage: "17.75",
      note: "Rango orientativo según categoría y provincia. Para una venta concreta se usa siempre el sale_fee real de la API.",
    },
    source: "Valores de referencia provistos por el usuario (septiembre 2026)",
    notes:
      "Sólo para simulación. Nunca reemplaza el cargo real informado por Mercado Libre.",
  },
  {
    ruleType: "FINANCING_COST" as const,
    name: "Costo de financiación — mismo precio en cuotas",
    values: {
      installments: {
        "3": "8.8",
        "6": "13.3",
        "9": "17.5",
        "12": "21.3",
      },
      note: "Porcentaje sobre el precio, de referencia. Si el cargo real llega por la API o por el reporte de Mercado Pago, se usa ese.",
    },
    source: "Valores de referencia provistos por el usuario (septiembre 2026)",
    notes: "Fallback para simulaciones de precio con cuotas.",
  },
  {
    ruleType: "FREE_SHIPPING_THRESHOLD" as const,
    name: "Umbral de envío gratis obligatorio",
    values: {
      threshold: null,
      note: "Sin valor cargado. Mercado Libre cambia este umbral con frecuencia; cargalo desde Configuración cuando lo confirmes. El costo real de cada envío se toma de shipments/{id}/costs, así que este umbral sólo afecta simulaciones.",
    },
    source: "Pendiente de carga por el usuario",
    notes:
      "Deliberadamente vacío: preferimos no tener el dato a inventar un umbral que cambiaría los precios simulados.",
  },
];

async function main() {
  for (const name of EXPENSE_CATEGORIES) {
    await prisma.transactionCategory.upsert({
      where: { direction_name: { direction: "EXPENSE", name } },
      create: { direction: "EXPENSE", name, isSystem: true },
      update: {},
    });
  }

  for (const name of INCOME_CATEGORIES) {
    await prisma.transactionCategory.upsert({
      where: { direction_name: { direction: "INCOME", name } },
      create: { direction: "INCOME", name, isSystem: true },
      update: {},
    });
  }

  const validFrom = new Date("2026-09-01T00:00:00.000Z");

  for (const rule of COMMERCIAL_RULES) {
    const existing = await prisma.commercialRule.findFirst({
      where: { siteId: "MLA", ruleType: rule.ruleType, validFrom },
    });

    if (!existing) {
      await prisma.commercialRule.create({
        data: {
          siteId: "MLA",
          ruleType: rule.ruleType,
          name: rule.name,
          validFrom,
          values: rule.values,
          source: rule.source,
          notes: rule.notes,
        },
      });
    }
  }

  const defaults: { key: string; value: string }[] = [
    { key: "safetyBuffer", value: "0" },
    { key: "obligationHorizonDays", value: "15" },
    { key: "adsOverSalesPct", value: "12" },
    { key: "marginDropPoints", value: "3" },
    { key: "costRisePct", value: "10" },
    {
      key: "allocationOrder",
      value:
        "INVENTORY_REPLACEMENT,CRITICAL_OBLIGATIONS,TAX_RESERVES,OPERATING_EXPENSES,SAFETY_BUFFER,PROFIT",
    },
  ];

  for (const setting of defaults) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      create: { key: setting.key, value: setting.value },
      update: {},
    });
  }

  console.log(
    `Seed completado: ${EXPENSE_CATEGORIES.length} categorías de egreso, ${INCOME_CATEGORIES.length} de ingreso, ${COMMERCIAL_RULES.length} reglas comerciales de referencia y ${defaults.length} parámetros.`,
  );
  console.log(
    "No se crearon cuentas, ventas ni saldos: esos datos sólo entran por sincronización o carga manual.",
  );
}

main()
  .catch((error) => {
    console.error("Error en el seed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
