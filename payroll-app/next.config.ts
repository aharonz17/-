import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "playwright-core", "exceljs"],
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
