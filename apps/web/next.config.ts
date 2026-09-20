import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@business-os/core",
    "@business-os/database",
    "@business-os/logger",
    "@business-os/types",
  ],
  serverExternalPackages: ["pg", "ioredis"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
