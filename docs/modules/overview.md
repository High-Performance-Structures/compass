HPS Compass Modules
===

Compass is a platform. HPS Compass is a product built on that platform.

The distinction matters. Compass Core provides authentication, an AI agent, theming, a plugin system, and dashboards. These are generic capabilities useful to any organization. HPS Compass adds construction-specific modules on top: scheduling with Gantt charts and critical path analysis, financial tracking tied to NetSuite, Google Drive integration for project documents, and a Capacitor mobile app for field workers taking photos on jobsites.

This separation isn't just organizational tidiness. It's the foundation for making Compass reusable. A mechanical engineering firm could rip out the construction modules and replace them with their own domain package. The scheduling module doesn't know about the AI agent. The NetSuite module doesn't know about theming. They integrate through Compass Core's extension points: schema tables, server actions, components, and optionally agent tools.


what is a module
---

A module in Compass is a bundle of related functionality that touches four layers:

**Schema tables** in `src/db/`. Each module can define its own schema file (e.g., `schema-netsuite.ts`, `schema-google.ts`) and register it in `drizzle.config.ts`. Tables use the same conventions as core: text UUIDs for IDs, ISO 8601 text dates, drizzle ORM with the D1 SQLite dialect.

**Server actions** in `src/app/actions/`. These are the data mutation layer. Every module exposes its logic through server actions that follow the standard pattern: authenticate the user, check RBAC permissions, do the work, revalidate affected paths, return `{ success: true }` or `{ success: false; error: string }`.

**Components** in `src/components/`. Module UI lives in its own subdirectory -- `components/netsuite/`, `components/files/`, `components/schedule/`, `components/financials/`, `components/native/`. These use the same shadcn/ui primitives and Tailwind conventions as everything else.

**Agent tools** (optional). Modules can register tools with the AI agent so users can interact with module functionality through natural language. The NetSuite and Google Drive modules don't currently have dedicated agent tools, but the plugin system provides a clear path for adding them.


the boundary between core and modules
---

Core is the part that stays when you swap out the domain package:

- Authentication (WorkOS SSO, middleware, session management)
- AI agent harness (provider, tools, system prompt, chat UI)
- Visual theme system (presets, custom themes, oklch color maps)
- Plugin/skills system (install, registry, loader)
- Custom dashboards (agent-built, saved views)
- Users, organizations, teams, groups
- RBAC permissions
- Feedback collection

Modules are the parts specific to HPS's construction business:

| module | what it does | key directories |
|--------|-------------|-----------------|
| NetSuite | bidirectional ERP sync | `lib/netsuite/`, `actions/netsuite-sync.ts`, `components/netsuite/` |
| Google Drive | document management via workspace delegation | `lib/google/`, `actions/google-drive.ts`, `components/files/` |
| Scheduling | Gantt charts, CPM, baseline tracking | `lib/schedule/`, `actions/schedule.ts`, `components/schedule/` |
| Financials | invoices, bills, payments, credit memos | `actions/invoices.ts`, `actions/vendor-bills.ts`, `components/financials/` |
| Mobile | Capacitor native wrapper, offline photos, push | `lib/native/`, `lib/push/`, `hooks/use-native*.ts`, `components/native/` |

Some tables blur the line. The `customers` and `vendors` tables in `schema.ts` are core entities used by multiple modules, but they have `netsuiteId` columns that only matter when the NetSuite module is active. The `projects` table has a `netsuiteJobId` column for the same reason. The `pushTokens` table lives in the core schema but is only meaningful to the mobile module. These are pragmatic compromises: splitting them into separate schemas would add complexity without real benefit at the current scale.


how modules integrate
---

Each module integrates with core through a consistent set of patterns. Here's the Google Drive module as an example:

Schema: `src/db/schema-google.ts` defines `googleAuth` (encrypted service account key, workspace domain, shared drive selection) and `googleStarredFiles` (per-user file starring stored locally since Google's star API is per-account). It also extends the core `users` table with a `googleEmail` column for impersonation overrides.

Actions: `src/app/actions/google-drive.ts` exports 17 server actions covering connection management, file CRUD, search, starred files, and storage quota. Every action calls `requireAuth()` and `requirePermission()` before touching data. Two-layer permissions: Compass RBAC gates whether you can even attempt the operation, then Google Workspace permissions determine what the impersonated user can actually see.

Components: `src/components/files/` contains the full file browser UI -- grid/list views, breadcrumb navigation, context menus, drag-drop upload, folder creation, rename/move dialogs, and a storage quota indicator. All built on shadcn/ui primitives.

The same pattern holds for every module. NetSuite has its own schema file, sync actions, and connection UI. Scheduling has its own type system, computation library, and multiple view components. The boundary is always: schema + actions + components, connected through Compass Core's auth and data conventions.


the path toward true modularity
---

Today, modules are organized by convention but not enforced by tooling. You could delete the entire `lib/netsuite/` directory and the schedule page would still work, but you'd also need to remove the schema file from drizzle config and clean up any imports.

The plugin/skills system (documented separately in the architecture section) is the mechanism for getting to genuine plug-and-play modules. Skills already work this way: a SKILL.md file on GitHub gets fetched, parsed, and injected into the agent's system prompt. Full plugin modules can provide tools, components, query types, and action handlers through a typed `PluginManifest`.

The eventual goal is that an HPS Compass module is just a plugin package: it declares its schema migrations, server actions, components, and agent tools in a manifest, and Compass Core loads them at runtime. We're not there yet. The current modules are still statically imported and wired together at build time. But the architecture is designed to make that transition possible without rewriting the modules themselves.
