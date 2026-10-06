import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright-core", "exceljs", "pdfjs-dist"],
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
