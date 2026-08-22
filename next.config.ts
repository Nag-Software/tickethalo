import type { NextConfig } from "next";

const supabaseHostname = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : "*.supabase.co";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  turbopack: {},
  images: {
    // Bildene serveres rett fra kilden i stedet for gjennom /_next/image.
    // Vercels bildeoptimalisering har en kvote på Hobby-planen, og når den er
    // brukt opp svarer den 402 og bildet blir borte fra siden. Uten optimizer
    // finnes ikke den feilen — men filene går ut i full størrelse, så dette
    // står til opplastingene skaleres ned ved lagring (sharp).
    // remotePatterns under brukes ikke så lenge dette står, men blir stående
    // slik at det er én linje å skru tilbake.
    unoptimized: true,
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
    serverActions: {
      bodySizeLimit: "50mb",
    },
    // Gjelder kun `npm run dev:webpack`. Turbopack ignorerer dem.
    // `preloadEntriesOnStart` er fjernet: Turbopack avviser den med ⨯ og
    // skriver en advarsel ved hver oppstart.
    webpackMemoryOptimizations: true,
  },
  // Brukes bare av dev:webpack-fallbacken.
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
