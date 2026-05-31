import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
