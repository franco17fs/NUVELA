import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El motor financiero y los clientes de integración nunca deben terminar en el bundle
  // del navegador: contienen lógica de negocio y tocan secretos server-side.
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
