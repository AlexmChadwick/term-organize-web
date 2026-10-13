import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // web-push talks to push services with Node's http stack. Keep it out of the bundle.
  serverExternalPackages: ["web-push"],
};

export default nextConfig;
