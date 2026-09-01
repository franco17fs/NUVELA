"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatARS } from "@/lib/money";

/**
 * Facturación y contribución por día.
 *
 * ## Decisiones de visualización
 *
 * - **Un solo eje.** Las dos series están en pesos, así que comparten escala.
 *   El margen porcentual NO se grafica acá: mezclarlo obligaría a un segundo eje
 *   y dos escalas distintas en el mismo gráfico hacen que la relación entre las
 *   curvas sea puro artefacto de dónde se pusieron los ceros. El margen vive en
 *   su propio KPI y en su propio gráfico.
 * - **Dos colores validados** (azul/naranja): separación de color suficiente para
 *   daltonismo, verificada con el validador de paleta, no a ojo.
 * - **Leyenda siempre presente** con dos series: la identidad no puede depender
 *   sólo del color.
 * - **Grilla recesiva**: horizontal, fina y clara. La grilla ayuda a leer
 *   valores, no compite con los datos.
 */

const SERIES = {
  facturacion: { color: "#2a78d6", label: "Facturación" },
  contribucion: { color: "#eb6834", label: "Contribución" },
} as const;

export interface DailyChartPoint {
  date: string;
  facturacion: number;
  contribucion: number;
}

export function DailyChart({ data }: { data: DailyChartPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-ink-muted">
        No hay ventas en el período seleccionado.
      </p>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0" }}
            minTickGap={16}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={72}
            tickFormatter={(value: number) => compactARS(value)}
          />
          <Tooltip
            cursor={{ stroke: "#94a3b8", strokeWidth: 1 }}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 12,
              fontVariantNumeric: "tabular-nums",
            }}
            formatter={(value, name) => [
              formatARS(typeof value === "number" ? value : 0),
              SERIES[String(name) as keyof typeof SERIES]?.label ?? String(name),
            ]}
            labelFormatter={(label) => `Día ${String(label)}`}
          />
          <Legend
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            formatter={(name) => SERIES[String(name) as keyof typeof SERIES]?.label ?? String(name)}
          />
          <Line
            type="monotone"
            dataKey="facturacion"
            stroke={SERIES.facturacion.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#ffffff" }}
          />
          <Line
            type="monotone"
            dataKey="contribucion"
            stroke={SERIES.contribucion.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#ffffff" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Etiquetas de eje compactas: "$1,2 M" en vez de "$1.200.000". */
function compactARS(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)} M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)} k`;
  return `$${value}`;
}
