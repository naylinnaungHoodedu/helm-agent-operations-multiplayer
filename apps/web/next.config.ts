import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@helm/content-schema"]
};

export default nextConfig;
