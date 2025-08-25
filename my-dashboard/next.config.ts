import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["onnxruntime-node"],
  },
};

export default nextConfig;
