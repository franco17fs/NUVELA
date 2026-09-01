import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NUVELA · Centro financiero",
  description:
    "Rentabilidad y cashflow para vendedores de Mercado Libre Argentina: cuánto vendiste, cuánto ganaste y cuánto podés gastar hoy.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
