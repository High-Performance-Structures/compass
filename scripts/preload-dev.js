/**
 * Preload script for Cloudflare bypass
 * 
 * This script patches Node.js module resolution before Next.js starts,
 * redirecting @opennextjs/cloudflare imports to our local shim.
 * 
 * Usage: NODE_OPTIONS="--require ./scripts/preload-dev.js" bun dev
 */

const Module = require("module");
const path = require("path");

const isBypassMode = process.env.BYPASS_AUTH === "true";

if (isBypassMode) {
    console.log("[DEV] Preload: Enabling Cloudflare bypass mode");
    
    const originalResolveFilename = Module._resolveFilename;
    const shimPath = path.resolve(__dirname, "../src/lib/cloudflare-shim.ts");
    
    Module._resolveFilename = function (request, parent, isMain, options) {
        // Redirect @opennextjs/cloudflare to our shim
        if (request === "@opennextjs/cloudflare") {
            console.log("[DEV] Preload: Intercepting import of @opennextjs/cloudflare");
            return shimPath;
        }
        
        return originalResolveFilename(request, parent, isMain, options);
    };
}