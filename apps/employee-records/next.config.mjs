/** @type {import('next').NextConfig} */
const nextConfig = {
  // @hris/database ships raw source (no build step), so Next must transpile it
  // like first-party app code rather than treating it as a prebuilt dependency.
  transpilePackages: ["@hris/database"],

  // Keep the Prisma runtime + Postgres driver OUT of the bundle. These are
  // server-only, use native/wasm bits, and must be require()'d from node_modules
  // at runtime instead of being packed by the bundler.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/client-runtime-utils",
    "@prisma/adapter-pg",
    "pg",
  ],
};

export default nextConfig;
