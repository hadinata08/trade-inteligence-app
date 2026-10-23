import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server dev kedua (mis. port 3001) bisa memakai folder build sendiri tanpa menimpa `.next` milik `next start`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@iti/shared", "@iti/database", "@iti/analytics", "@iti/comtrade", "@iti/excel"],
  serverExternalPackages: ["@prisma/client", "prisma", "bullmq", "ioredis", "exceljs", "jszip"],
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
