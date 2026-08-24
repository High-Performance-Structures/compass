import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: [
    "./src/db/schema.ts",
    "./src/db/schema-netsuite.ts",
    "./src/db/schema-plugins.ts",
    "./src/db/schema-agent.ts",
    "./src/db/schema-ai-config.ts",
    "./src/db/schema-theme.ts",
    "./src/db/schema-google.ts",
    "./src/db/schema-dashboards.ts",
    "./src/db/schema-mcp.ts",
    "./src/db/schema-conversations.ts",
    "./src/db/schema-sage.ts",
    "./src/db/schema-buildertrend.ts",
    "./src/db/schema-estimates.ts",
    "./src/db/schema-nutech.ts",
    "./src/db/schema-templates.ts",
    "./src/lib/sync/schema.ts",
  ],
  out: "./drizzle",
  dialect: "sqlite",
})
