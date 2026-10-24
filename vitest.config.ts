import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // AuthKit imports this extensionless ESM path, which Node 24 no longer resolves.
      "next/cache": require.resolve("next/cache.js"),
      // Next enforces this boundary during its server build; Vitest executes
      // server actions directly and needs a no-op test resolver.
      "server-only": path.resolve(__dirname, "./src/test/server-only.ts"),
    },
  },
  test: {
    server: {
      deps: {
        inline: ["@workos-inc/authkit-nextjs"],
      },
    },
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts", "__tests__/**/*.test.ts", "mobile-shell-src/**/*.test.ts"],
    exclude: ["node_modules", "references", "packages"],
  },
})
