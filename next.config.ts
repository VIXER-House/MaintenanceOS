import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg + the Prisma driver adapter must run in the Node.js runtime, not be bundled.
  output: process.env.STANDALONE_TEST ? "standalone" : undefined,
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "exceljs"],
  // Prisma loads its query-compiler WASM with fs at runtime, which Next's file tracing
  // cannot see. Ship it explicitly so serverless deployments (Vercel) can query the DB.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/.prisma/client/*.wasm",
      "./node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/*.wasm",
      // read by the first-run bootstrap
      "./prisma/migrations/**/*",
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
