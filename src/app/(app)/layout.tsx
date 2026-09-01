import { Suspense } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { GlobalFilters } from "@/components/layout/global-filters";
import { listAccounts } from "@/server/queries/accounts";

/**
 * Marco de la aplicación: navegación fija a la izquierda y filtros globales
 * arriba, presentes en todas las pantallas.
 *
 * Los filtros van dentro de `Suspense` porque leen la query string con
 * `useSearchParams`, que en el App Router obliga a un límite de suspensión.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const accounts = await listAccounts();

  return (
    <div className="flex h-screen overflow-hidden">
      <Suspense fallback={<div className="w-56 shrink-0 border-r border-border-subtle bg-surface" />}>
        <Sidebar />
      </Suspense>

      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div className="h-14 border-b border-border-subtle bg-surface" />}>
          <GlobalFilters accounts={accounts} />
        </Suspense>

        <main className="scroll-slim flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
