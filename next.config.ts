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
    // Keep the native SQLite development shim out of the production Worker.
    turbopack: {
        resolveAlias: {
            "@/lib/cloudflare-context":
                process.env.NODE_ENV === "production"
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
