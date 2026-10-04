import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg + the Prisma driver adapter must run in the Node.js runtime, not be bundled.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
