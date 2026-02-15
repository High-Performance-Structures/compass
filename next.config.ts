import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    eslint: {
        ignoreDuringBuilds: true,
    },
    experimental: {
        optimizePackageImports: [
            "@tabler/icons-react",
            "lucide-react",
            "@radix-ui/react-icons",
            "recharts",
            "@workos-inc/node",
            "date-fns",
            "remeda",
            "framer-motion",
        ],
    },
    // Node.js native modules that should not be bundled for edge/browser
    // memory-provider imports better-sqlite3 which cannot run in Cloudflare Workers
    serverExternalPackages: ["better-sqlite3", "./src/db/provider/memory-provider"],
};

export default nextConfig;

// Enable calling `getCloudflareContext()` in `next dev`.
// See https://opennext.js.org/cloudflare/bindings#local-access-to-bindings.
// Only init in dev -- build and lint don't need the wrangler proxy.
if (process.env.NODE_ENV === "development") {
    import("@opennextjs/cloudflare").then((mod) =>
        mod.initOpenNextCloudflareForDev()
    );
}
