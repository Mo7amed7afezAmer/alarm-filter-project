import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The REST API is the NestJS service (apps/api). The browser keeps calling /api/* on this origin
// (session cookie included); Next.js proxies it there. Only /api/auth/* (NextAuth web sign-in)
// is served here. Rewrites are fixed at `next build`: the Docker build passes API_URL.
const API_URL = (process.env.API_URL || "http://127.0.0.1:4100").replace(/\/$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      // NextAuth's /api/auth/[...nextauth] would otherwise catch the mobile token endpoint.
      beforeFiles: [{ source: "/api/auth/token", destination: `${API_URL}/api/auth/token` }],
      afterFiles: [],
      fallback: [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }],
    };
  },
  // A second dev server (e.g. the hourly mock on :3100) needs its own build dir.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Standalone is what the Docker image runs. Native Windows builds skip it because copying
  // pnpm's symlinked node_modules needs symlink privilege (Developer Mode).
  output: process.platform === "win32" ? undefined : "standalone",
  // Trace workspace packages (packages/*) from the monorepo root into the standalone bundle.
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../../"),
    // Proxied API calls (hourly report processing, exports) may take longer than the 30s default.
    proxyTimeout: 120_000,
  },
  transpilePackages: ["@alarm/core"],
};

export default nextConfig;
