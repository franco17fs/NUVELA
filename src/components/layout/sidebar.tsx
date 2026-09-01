"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  Boxes,
  CalendarClock,
  ClipboardList,
  CreditCard,
  FileText,
  LayoutDashboard,
  LineChart,
  Megaphone,
  Package,
  Receipt,
  Scale,
  Settings,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Navegación principal (§46 del brief).
 *
 * Los enlaces conservan los filtros globales (cuenta y período) en la query
 * string: si el usuario está mirando la quincena de la Cuenta 2 y pasa a
 * Rentabilidad, tiene que seguir viendo la quincena de la Cuenta 2. Perder el
 * contexto al navegar es la forma más rápida de que un dashboard se vuelva
 * incómodo.
 */

const SECTIONS: { label: string; items: { href: string; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    label: "Negocio",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/ventas", label: "Ventas", icon: ShoppingCart },
      { href: "/productos", label: "Productos", icon: Package },
      { href: "/rentabilidad", label: "Rentabilidad", icon: BarChart3 },
    ],
  },
  {
    label: "Mercadería",
    items: [
      { href: "/mercaderia", label: "Mercadería", icon: Boxes },
      { href: "/compras", label: "Compras", icon: ClipboardList },
      { href: "/publicidad", label: "Publicidad", icon: Megaphone },
    ],
  },
  {
    label: "Dinero",
    items: [
      { href: "/cashflow", label: "Cashflow", icon: LineChart },
      { href: "/obligaciones", label: "Obligaciones", icon: CalendarClock },
      { href: "/movimientos", label: "Ingresos/Egresos", icon: Receipt },
      { href: "/mercado-pago", label: "Mercado Pago", icon: Wallet },
    ],
  },
  {
    label: "Control",
    items: [
      { href: "/facturacion", label: "Facturación", icon: FileText },
      { href: "/conciliacion", label: "Conciliación", icon: Scale },
      { href: "/proyecciones", label: "Proyecciones", icon: CreditCard },
      { href: "/configuracion", label: "Configuración", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Sólo se propagan los filtros globales, no cualquier parámetro de la página
  // actual (un `orderId` no tiene sentido en otra sección).
  const preserved = new URLSearchParams();
  for (const key of ["cuenta", "periodo", "desde", "hasta"]) {
    const value = searchParams.get(key);
    if (value) preserved.set(key, value);
  }
  const suffix = preserved.toString() ? `?${preserved.toString()}` : "";

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col border-r border-border-subtle bg-surface">
      <div className="px-5 py-5">
        <p className="text-lg font-semibold tracking-tight text-ink">NUVELA</p>
        <p className="text-xs text-ink-subtle">Centro financiero</p>
      </div>

      <div className="scroll-slim flex-1 overflow-y-auto px-3 pb-6">
        {SECTIONS.map((section) => (
          <div key={section.label} className="mb-5">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    <Link
                      href={`${item.href}${suffix}`}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition",
                        active
                          ? "bg-brand-soft font-medium text-brand"
                          : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
