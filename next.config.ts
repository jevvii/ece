import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  turbopack: { root: process.cwd() },
  // The time-report upload action accepts files up to 10 MB; the default
  // server-action limit is 1 MB, which rejects real ODS exports.
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  outputFileTracingIncludes: {
    "/payroll/2316/[employeeId]/pdf": ["./public/forms/bir-2316-2021.pdf"],
  },
};

export default nextConfig;
