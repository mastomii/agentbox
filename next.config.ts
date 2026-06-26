import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a minimal self-contained server (.next/standalone) for tiny Docker images.
  output: "standalone",
};

export default nextConfig;
