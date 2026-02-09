/**
 * Module Patching for Development Bypass
 * 
 * This file patches Node.js module loading to redirect @opennextjs/cloudflare
 * imports to our local shim when BYPASS_AUTH is enabled.
 */

import Module from "module";
import type { NextConfig } from "next";

const isBypassMode = process.env.BYPASS_AUTH === "true";

if (isBypassMode) {
    const originalResolveFilename = (Module as any)._resolveFilename;

    (Module as any)._resolveFilename = function (
        request: string,
        parent: any,
        isMain: boolean,
        options?: any
    ) {
        // Redirect @opennextjs/cloudflare to our shim
        if (request === "@opennextjs/cloudflare") {
            return require.resolve("./src/lib/cloudflare-shim.ts");
        }

        return originalResolveFilename(request, parent, isMain, options);
    };

    console.log("[DEV] Module patching enabled for Cloudflare bypass");
}

// Initialize Cloudflare for development when not in bypass mode
// This must happen before any getCloudflareContext calls
if (!isBypassMode) {
    const { initOpenNextCloudflareForDev } = require("@opennextjs/cloudflare");
    initOpenNextCloudflareForDev();
    console.log("[DEV] Cloudflare context initialized");
}

const nextConfig: NextConfig = {
    eslint: {
        ignoreDuringBuilds: true,
    },
    typescript: {
        ignoreBuildErrors: true,
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