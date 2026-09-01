import { Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { ExpenseForm, IncomeForm } from "@/components/movements/movement-forms";
import { prisma } from "@/lib/prisma";
import { formatARS, money, ZERO } from "@/lib/money";
import { formatBusinessDate } from "@/lib/dates";
import { resolveContext, type SearchParams } from "@/server/queries/request-context";
import { listAccounts } from "@/server/queries/accounts";

export const dynamic = "force-dynamic";

/**
 * Ingresos y egresos manuales (§16 y §17 del brief).
 *
 * Los ingresos externos se listan aparte y NUNCA se suman al GMV de Mercado
 * Libre: mezclarlos inflaría la facturación con plata que no salió de una venta
 * y arruinaría todos los márgenes.
 */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope, period } = resolveContext(params);

  const accountFilter =
    scope.kind === "ACCOUNT" ? { sellerAccountId: scope.sellerAccountId } : {};

  const [expenses, incomes, categories, accounts] = await Promise.all([
    prisma.expense.findMany({
      where: { ...accountFilter, businessDate: { gte: period.from, lte: period.to } },
      orderBy: { businessDate: "desc" },
      include: { category: true, sellerAccount: { select: { nickname: true } } },
      take: 200,
    }),
    prisma.income.findMany({
      where: { ...accountFilter, businessDate: { gte: period.from, lte: period.to } },
      orderBy: { businessDate: "desc" },
      include: { category: true },
      take: 200,
    }),
    prisma.transactionCategory.findMany({
      where: { active: true },
      orderBy: [{ direction: "asc" }, { name: "asc" }],
    }),
    listAccounts(),
  ]);

  const totalExpenses = expenses.reduce((acc, expense) => acc.plus(money(expense.amount)), ZERO);
  const totalIncomes = incomes.reduce((acc, income) => acc.plus(money(income.amount)), ZERO);

  const byCategory = new Map<string, ReturnType<typeof money>>();
  for (const expense of expenses) {
    byCategory.set(
      expense.category.name,
      (byCategory.get(expense.category.name) ?? ZERO).plus(money(expense.amount)),
    );
  }
  const topCategories = [...byCategory.entries()].sort((a, b) => b[1].comparedTo(a[1])).slice(0, 6);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Ingresos y egresos
        </h1>
        <p className="text-sm text-ink-muted">
          {period.label} · movimientos que no vienen de Mercado Libre
        </p>
      </header>

      <KpiGrid>
        <Kpi label="Egresos del período" value={totalExpenses} higherIsBetter={false} />
        <Kpi label="Ingresos externos" value={totalIncomes} />
        <Kpi label="Neto" value={totalIncomes.minus(totalExpenses)} />
        <Kpi label="Movimientos" value={expenses.length + incomes.length} format="number" />
      </KpiGrid>

      {topCategories.length > 0 ? (
        <Card>
          <CardHeader title="Gastos por categoría" description="Las seis categorías más pesadas." />
          <CardBody className="space-y-2">
            {topCategories.map(([name, amount]) => {
              const share = totalExpenses.isZero()
                ? 0
                : Number(amount.div(totalExpenses).times(100).toFixed(1));
              return (
                <div key={name}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink-muted">{name}</span>
                    <span className="tabular">
                      {formatARS(amount)}{" "}
                      <span className="text-xs text-ink-subtle">{share}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-surface-sunken">
                    <div
                      className="h-1.5 rounded-full bg-[#2a78d6]"
                      style={{ width: `${Math.min(share, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Registrar egreso" />
          <CardBody>
            <ExpenseForm
              accounts={accounts}
              categories={categories
                .filter((category) => category.direction === "EXPENSE")
                .map((category) => ({ id: category.id, name: category.name }))}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Registrar ingreso externo"
            description="No se suma al GMV de Mercado Libre."
          />
          <CardBody>
            <IncomeForm
              accounts={accounts}
              categories={categories
                .filter((category) => category.direction === "INCOME")
                .map((category) => ({ id: category.id, name: category.name }))}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Egresos" />
        {expenses.length === 0 ? (
          <EmptyState title="Sin egresos" description="No hay gastos cargados en el período." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Categoría</Th>
                <Th>Proveedor</Th>
                <Th>Cuenta</Th>
                <Th>Notas</Th>
                <Th align="right">Importe</Th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id}>
                  <Td>{formatBusinessDate(expense.businessDate)}</Td>
                  <Td>{expense.category.name}</Td>
                  <Td>{expense.supplier ?? "—"}</Td>
                  <Td className="text-xs">{expense.sellerAccount?.nickname ?? "Todo el negocio"}</Td>
                  <Td className="max-w-xs truncate text-xs text-ink-muted">
                    {expense.notes ?? ""}
                  </Td>
                  <Td align="right">{formatARS(money(expense.amount))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {incomes.length > 0 ? (
        <Card>
          <CardHeader title="Ingresos externos" />
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Categoría</Th>
                <Th>Descripción</Th>
                <Th align="right">Importe</Th>
              </tr>
            </thead>
            <tbody>
              {incomes.map((income) => (
                <tr key={income.id}>
                  <Td>{formatBusinessDate(income.businessDate)}</Td>
                  <Td>{income.category.name}</Td>
                  <Td>{income.description ?? "—"}</Td>
                  <Td align="right">{formatARS(money(income.amount))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
