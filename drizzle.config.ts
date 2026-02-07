import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: [
    "./src/db/schema.ts",
    "./src/db/schema-netsuite.ts",
    "./src/db/schema-plugins.ts",
    "./src/db/schema-agent.ts",
    "./src/db/schema-ai-config.ts",
  ],
  out: "./drizzle",
  dialect: "sqlite",
})
