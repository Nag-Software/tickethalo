import type { NextConfig } from "next";

const supabaseHostname = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : "*.supabase.co";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Poster rendering reads these from process.cwd()/public at runtime (bundled
  // fonts for sharp/librsvg text + the frame overlay). Trace them into the
  // serverless function or text renders as tofu / the overlay silently drops.
  outputFileTracingIncludes: {
    "/**": ["./public/fonts/**", "./public/frame.png"],
  },
  turbopack: {},
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHostname,
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
        port: "",
        pathname: "/wikipedia/commons/**",
        search: "",
      },
    ],
  },
  experimental: {
    // Client router cache for dynamic pages (30s) — server actions still clear it immediately.
    staleTimes: {
      dynamic: 30,
    },
    serverActions: {
      bodySizeLimit: "50mb",
    },
    webpackMemoryOptimizations: true,
    preloadEntriesOnStart: false,
    // @hugeicons/core-free-icons is a large barrel (~46MB) that isn't optimized by
    // Next's defaults — transform imports so only referenced icons are pulled in.
    optimizePackageImports: ["@hugeicons/core-free-icons"],
  },
  webpack(config, { dev }) {
    if (dev) {
      // Limit parallel module compilation to reduce peak memory during rebuilds
      config.parallelism = 2;
      // Debounce file-watcher rebuilds — fewer rapid recompiles = lower memory spikes
      config.watchOptions = {
        ...config.watchOptions,
        aggregateTimeout: 400,
        poll: false,
      };
    }
    return config;
  },
};

export default nextConfig;
