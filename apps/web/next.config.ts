import type { NextConfig } from "next";

const apiOrigin = process.env.API_URL ?? "http://localhost:4000";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets a production build and `next start` (for example an agent's e2e run) use
  // their own folder instead of `.next`, which a running `next dev` in this app also writes to.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@leadforge/ui"],
  typedRoutes: false,
  async rewrites() {
    // Same-origin API calls so auth cookies and CSRF work without CORS.
    const rules = [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
    // Dev-only component gallery. A "%5F_design" folder trips a Next 15.5 build invariant
    // (/_not-found entry lookup), so the page lives at app/(dev)/app/design-gallery and the
    // documented URL is a rewrite. Production builds get neither the rewrite nor the gallery.
    if (process.env.NODE_ENV !== "production") {
      rules.push({ source: "/app/_design", destination: "/app/design-gallery" });
    }
    return rules;
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
