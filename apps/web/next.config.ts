import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ["@leadvirt/ui", "@leadvirt/types"]
};

export default nextConfig;
