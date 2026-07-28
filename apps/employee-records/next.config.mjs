/** @type {import('next').NextConfig} */
const nextConfig = {
  // @hris/database ships raw source (no build step), so Next must transpile it
  // like first-party app code rather than treating it as a prebuilt dependency.
  transpilePackages: ["@hris/database", "@hris/auth", "@hris/types"],

  // Keep the Prisma runtime + Postgres driver OUT of the bundle. These are
  // server-only, use native/wasm bits, and must be require()'d from node_modules
  // at runtime instead of being packed by the bundler.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/client-runtime-utils",
    "@prisma/adapter-pg",
    "pg",
  ],

  // Baseline security headers on every response. The CSP is permissive on inline scripts/styles
  // (Next needs them without a per-request nonce); tightening to a nonce-based CSP is a future step.
  // Everything else is strict: no framing (clickjacking), no MIME sniffing, HSTS, tight referrer.
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
