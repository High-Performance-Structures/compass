import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: ["./src/db/schema.ts", "./src/db/schema-netsuite.ts"],
  out: "./drizzle",
  dialect: "sqlite",
})
