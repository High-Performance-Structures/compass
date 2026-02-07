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
