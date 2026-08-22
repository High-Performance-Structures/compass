import type { NextConfig } from "next";

const deploymentId =
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.WORKERS_CI_BUILD_UUID ??
    (process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
        : undefined);

const nextConfig: NextConfig = {
    allowedDevOrigins: ["127.0.0.1"],
    deploymentId,
    // OpenNext sets this flag before its Next.js build. Keep the native SQLite
    // shim out of Workers without breaking production-mode local/E2E builds.
    turbopack: {
        resolveAlias: {
            "@/lib/cloudflare-context":
                process.env.NEXT_PRIVATE_STANDALONE === "true"
                    ? "./src/lib/cloudflare-context.production.ts"
                    : "./src/lib/cloudflare-context.ts",
        },
    },
    env: {
        NEXT_PUBLIC_COMPASS_DEPLOYMENT_ID: deploymentId ?? "development",
    },
    transpilePackages: ["agent-core"],
    experimental: {
        proxyClientMaxBodySize: "100mb",
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

// Cloudflare dev proxy removed for local dev - uses the local SQLite D1 shim instead
