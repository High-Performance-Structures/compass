Data Layer
===

Compass stores everything in Cloudflare D1, which is SQLite at the edge. The ORM is Drizzle, configured in `drizzle.config.ts` to read from 8 schema files. This document covers the schema design, how the database is accessed, and why D1 over Postgres.


why D1
---

The short answer: co-location. Compass runs as a Cloudflare Worker, and D1 is SQLite running in the same data center as the worker. Queries take single-digit milliseconds because there's no network round-trip to a database server. For a project management tool where every page load fires 3-5 queries, this matters.

The longer answer involves tradeoffs. D1 is SQLite, which means:

- No native JSON column type (we store JSON as text and parse in application code)
- No `RETURNING` clause on inserts (we generate IDs before inserting)
- No concurrent writes from multiple connections (fine for Workers, where each request gets its own isolate)
- No `ENUM` types (we use text columns with TypeScript union types)

What we get in return: zero configuration, no connection pooling, no cold start penalty, automatic replication, and a database that survives the worker being evicted. For an application that reads more than it writes and runs at the edge, the tradeoffs are favorable.


schema organization
---

The schema is split across 8 files, registered in `drizzle.config.ts`:

```typescript
// drizzle.config.ts
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
  ],
  out: "./drizzle",
  dialect: "sqlite",
})
```

The split isn't arbitrary. Each file maps to a feature boundary:

**`schema.ts`** -- core tables. This is the foundation that everything else references.

- `users` -- WorkOS user IDs as primary keys, roles (admin/office/field/client), optional `google_email` for Drive impersonation
- `organizations`, `organizationMembers` -- multi-tenant org structure
- `teams`, `teamMembers` -- teams within orgs
- `groups`, `groupMembers` -- cross-org permission groups
- `projects`, `projectMembers` -- the central domain entity
- `scheduleTasks`, `taskDependencies` -- Gantt chart data
- `workdayExceptions`, `scheduleBaselines` -- calendar and snapshot tracking
- `customers`, `vendors` -- CRM basics, with optional `netsuite_id` columns
- `feedback`, `feedbackInterviews` -- user feedback and UX research
- `agentConversations`, `agentMemories` -- chat persistence
- `slabMemories` -- persistent memory (preferences, workflows, facts, decisions)
- `pushTokens` -- native app push notification tokens

**`schema-netsuite.ts`** -- NetSuite integration tables.

- `netsuiteAuth` -- encrypted OAuth tokens
- `netsuiteSyncMetadata` -- per-record sync tracking (status, conflicts, retries)
- `netsuiteSyncLog` -- sync run history
- `invoices`, `vendorBills`, `payments`, `creditMemos` -- financial records that sync bidirectionally

**`schema-plugins.ts`** -- plugin/skills system.

- `plugins` -- installed plugin registry (name, source, capabilities, status)
- `pluginConfig` -- per-plugin key-value settings (supports encrypted values)
- `pluginEvents` -- audit log of installs, enables, disables

**`schema-agent.ts`** -- agent items (todos, notes, checklists created by the AI).

- `agentItems` -- type-polymorphic items with parent-child relationships

**`schema-ai-config.ts`** -- AI model configuration and usage tracking.

- `agentConfig` -- singleton config row (global model selection, cost ceiling)
- `userModelPreference` -- per-user model override
- `agentUsage` -- token counts and cost estimates per streamText invocation

**`schema-theme.ts`** -- visual themes.

- `customThemes` -- user-created themes (full oklch color maps stored as JSON)
- `userThemePreference` -- which theme each user has active

**`schema-google.ts`** -- Google Drive integration.

- `googleAuth` -- encrypted service account keys per organization
- `googleStarredFiles` -- per-user starred Drive files

**`schema-dashboards.ts`** -- agent-built custom dashboards.

- `customDashboards` -- saved dashboard specs (JSON), queries, and render prompts


design conventions
---

Every table follows the same patterns:

**Text IDs.** Primary keys are text columns containing UUIDs, generated via `crypto.randomUUID()` before insert. Not auto-increment integers. This avoids sequential ID exposure and works across distributed systems.

```typescript
export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // ...
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
})
```

**Text dates.** All timestamps are ISO 8601 strings stored in text columns, not integer unix timestamps. This makes them human-readable in raw queries and avoids timezone confusion. The application always generates them with `new Date().toISOString()`.

**Explicit foreign keys.** References use Drizzle's `.references()` with explicit `onDelete` behavior. Most use `cascade` for cleanup, some use no action for soft-reference relationships.

```typescript
export const organizationMembers = sqliteTable("organization_members", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  joinedAt: text("joined_at").notNull(),
})
```

**Type exports.** Every table exports both `Select` and `Insert` types via Drizzle's `$inferSelect` and `$inferInsert`:

```typescript
export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
```

**JSON-as-text.** Complex data (theme definitions, dashboard specs, sync conflict data, line items) is stored as JSON-stringified text. This is a D1 constraint -- there's no native JSON column type. Parsing happens in application code.


accessing the database
---

The database is accessed through `getDb()` in `src/db/index.ts`, which wraps Drizzle's `drizzle()` function with all schema files merged:

```typescript
import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema"
import * as netsuiteSchema from "./schema-netsuite"
import * as pluginSchema from "./schema-plugins"
import * as agentSchema from "./schema-agent"
import * as aiConfigSchema from "./schema-ai-config"
import * as themeSchema from "./schema-theme"
import * as googleSchema from "./schema-google"
import * as dashboardSchema from "./schema-dashboards"

const allSchemas = {
  ...schema,
  ...netsuiteSchema,
  ...pluginSchema,
  ...agentSchema,
  ...aiConfigSchema,
  ...themeSchema,
  ...googleSchema,
  ...dashboardSchema,
}

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema: allSchemas })
}
```

The `D1Database` binding comes from the Cloudflare runtime. In server actions, you get it via:

```typescript
const { env } = await getCloudflareContext()
const db = getDb(env.DB)
```

The `getDb()` function is called per-request -- it creates a new Drizzle instance each time. This is intentional. Cloudflare Workers are stateless isolates; there's no persistent connection to reuse. The cost of creating the Drizzle wrapper is negligible compared to the query itself.


migration workflow
---

Migrations are generated by Drizzle Kit and stored in the `drizzle/` directory. The workflow:

1. Edit schema files in `src/db/`
2. Run `bun run db:generate` -- Drizzle Kit diffs the schema against the last migration and generates a new SQL migration file
3. Run `bun run db:migrate:local` -- applies migrations to the local D1 database (via Wrangler)
4. Run `bun run db:migrate:prod` -- applies migrations to the production D1 database

Migrations are append-only. Never modify an existing migration file. If a migration is wrong, generate a new one that corrects it.

The generated SQL files are plain SQLite DDL. No Drizzle-specific runtime is needed to apply them -- Wrangler's `d1 migrations apply` handles execution directly. This means the migration system is ORM-portable: if you swapped Drizzle for something else, the existing migrations would still work.
