import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@duckdb/node-api", "pdfjs-dist", "@napi-rs/canvas"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Content-Type",
            value: "application/manifest+json; charset=utf-8",
          },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/api/cron/sop-work": ["./lib/sops/extract-document.mjs", "./node_modules/pdfjs-dist/package.json", "./node_modules/pdfjs-dist/legacy/build/*.mjs", "./node_modules/pdfjs-dist/standard_fonts/**/*", "./node_modules/pdfjs-dist/cmaps/**/*", "./node_modules/pdfjs-dist/wasm/**/*", "./node_modules/@napi-rs/canvas*/**/*", "./node_modules/@zip.js/zip.js/**/*", "./node_modules/fast-xml-parser/**/*", "./node_modules/fast-xml-builder/**/*", "./node_modules/strnum/**/*", "./node_modules/anynum/**/*", "./node_modules/@nodable/entities/**/*", "./node_modules/is-unsafe/**/*", "./node_modules/path-expression-matcher/**/*", "./node_modules/xml-naming/**/*", "./node_modules/image-size/**/*"],
    "/*": [
      "./node_modules/@duckdb/node-api/**/*",
      "./node_modules/@duckdb/node-bindings/**/*",
      "./node_modules/@duckdb/node-bindings-*/*",
      "./node_modules/detect-libc/**/*",
    ],
  },
};

export default nextConfig;
