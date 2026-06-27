import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@duckdb/node-api"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@duckdb/node-api/**/*",
      "./node_modules/@duckdb/node-bindings/**/*",
      "./node_modules/@duckdb/node-bindings-*/*",
      "./node_modules/detect-libc/**/*",
    ],
  },
};

export default nextConfig;
