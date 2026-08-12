import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // AuthKit imports this extensionless ESM path, which Node 24 no longer resolves.
      "next/cache": path.resolve(__dirname, "./node_modules/next/cache.js"),
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
    include: ["src/**/__tests__/**/*.test.ts", "__tests__/**/*.test.ts"],
    exclude: ["node_modules", "references", "packages"],
  },
})
