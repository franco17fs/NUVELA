import { describe, expect, it } from "vitest";
import {
  allocateProportionally,
  applyPercentage,
  clampNonNegative,
  formatPercent,
  isPositive,
  money,
  percentage,
  ratio,
  sum,
  toMoneyString,
} from "@/lib/money";

describe("aritmética de dinero", () => {
  it("no arrastra el error del punto flotante", () => {
    // El caso canónico: en `number`, 0.1 + 0.2 === 0.30000000000000004
    expect(money(0.1).plus(money(0.2)).toString()).toBe("0.3");
    expect(sum([0.1, 0.2, 0.3]).toString()).toBe("0.6");
  });

  it("normaliza strings, números y nulos", () => {
    expect(money("1234.56").toString()).toBe("1234.56");
    expect(money(null).toString()).toBe("0");
    expect(money(undefined).toString()).toBe("0");
    expect(money("").toString()).toBe("0");
    // Un valor corrupto no revienta el cálculo: vale cero y queda visible en 0.
    expect(money("no es un número").toString()).toBe("0");
    expect(money(Number.NaN).toString()).toBe("0");
  });

  it("acepta un Decimal que viene de otra instancia del módulo (el de Prisma)", () => {
    // Prisma devuelve los NUMERIC como Decimal de SU copia de decimal.js, así
    // que `instanceof` contra el nuestro da false. Antes esto rompía con
    // "value.trim is not a function" al renderizar cualquier página con datos.
    const prismaLikeDecimal = {
      toString: () => "1234.5600",
      // decimal.js expone estas propiedades internas; se incluyen para que el
      // objeto se parezca a lo que realmente llega desde la base.
      s: 1,
      e: 3,
      d: [1234, 5600000],
    };

    expect(money(prismaLikeDecimal).toString()).toBe("1234.56");
    expect(sum([prismaLikeDecimal, "0.44"]).toString()).toBe("1235");
  });

  it("devuelve cero en vez de NaN o Infinity al dividir por cero", () => {
    expect(percentage(100, 0).toString()).toBe("0");
    expect(ratio(100, 0).toString()).toBe("0");
  });

  it("calcula porcentajes exactos", () => {
    expect(percentage(2905, 8000).toDecimalPlaces(4).toString()).toBe("36.3125");
    expect(applyPercentage(10000, 8.8).toString()).toBe("880");
    expect(formatPercent(percentage(1, 3), 2)).toBe("33.33%");
  });

  it("isPositive es ESTRICTAMENTE mayor que cero", () => {
    // decimal.js define isPositive() por el SIGNO, y el cero tiene signo
    // positivo: `new Decimal(0).isPositive() === true`. Usar ese método como
    // "tiene monto" hacía que una obligación sin nada reservado apareciera como
    // "parcialmente reservada". El helper del proyecto no tiene esa trampa.
    expect(money(0).isPositive()).toBe(true); // comportamiento de la librería
    expect(isPositive(0)).toBe(false); // el nuestro
    expect(isPositive(0.01)).toBe(true);
    expect(isPositive(-1)).toBe(false);
    expect(isPositive(null)).toBe(false);
  });

  it("nunca deja un disponible por debajo de cero", () => {
    expect(clampNonNegative(-500).toString()).toBe("0");
    expect(clampNonNegative(500).toString()).toBe("500");
  });

  it("serializa con dos decimales para cruzar al cliente", () => {
    expect(toMoneyString("1234.567")).toBe("1234.57");
    expect(toMoneyString(1000)).toBe("1000.00");
  });
});

describe("reparto proporcional", () => {
  it("reparte sin perder ni inventar centavos", () => {
    // Un envío de pack que hay que imputar a tres órdenes.
    const shares = allocateProportionally(100, [1, 1, 1]);
    // Con pesos iguales el residuo va al primero: el reparto es determinístico.
    expect(shares.map((s) => s.toString())).toEqual(["33.34", "33.33", "33.33"]);
    expect(sum(shares).toString()).toBe("100");
  });

  it("respeta los pesos", () => {
    const shares = allocateProportionally(1000, [700, 300]);
    expect(shares.map((s) => s.toString())).toEqual(["700", "300"]);
  });

  it("reparte en partes iguales si no hay pesos válidos", () => {
    const shares = allocateProportionally(90, [0, 0, 0]);
    expect(sum(shares).toString()).toBe("90");
    expect(shares).toHaveLength(3);
  });

  it("asigna el residuo a la porción más grande", () => {
    const shares = allocateProportionally(10, [999, 1]);
    expect(sum(shares).toString()).toBe("10");
    expect(shares[0]!.greaterThan(shares[1]!)).toBe(true);
  });

  it("devuelve lista vacía sin pesos", () => {
    expect(allocateProportionally(100, [])).toEqual([]);
  });
});
