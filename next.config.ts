import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Route handlers proxy Banner (no CORS) and read catalogs from disk, so the
  // release build is a Node server rather than a static export.
  output: "standalone",
  // web-push talks to push services with Node's http stack. Keep it out of the bundle.
  serverExternalPackages: ["web-push"],
};

export default nextConfig;
