Plugin and Skills System
===

Compass's AI agent can be extended with plugins and skills. The two terms describe different levels of integration: skills are lightweight prompt injections loaded from GitHub, while full plugins can contribute tools, components, query types, and action handlers.

The system lives in `src/lib/agent/plugins/` with four core files: types, skills-client, loader, and registry.


Skills vs plugins
---

A **skill** is a SKILL.md file hosted on GitHub (following the skills.sh format). When installed, the markdown body gets injected into the agent's system prompt at priority 80. That's it - skills don't run code, they just add knowledge and instructions to the agent. Think of them as specialized system prompt modules.

A **plugin** is a full TypeScript module that exports a manifest and optional tools, prompt sections, components, query types, and action handlers. Plugins can actually extend the agent's capabilities with new tool calls and UI components.

The tradeoff is clear: skills are safe and easy to install (just markdown text), while plugins require more trust since they execute code.


Source types
---

Four source types are defined in `src/lib/agent/plugins/types.ts`:

```typescript
export const PLUGIN_SOURCE_TYPES = [
  "builtin",  // bundled with Compass
  "local",    // loaded from local filesystem
  "npm",      // installed from npm
  "skills",   // GitHub-hosted SKILL.md files
] as const
```

Currently, `builtin` and `skills` are the only fully implemented source types. The `local` and `npm` loaders return "not yet supported" errors - they're infrastructure for future expansion.


How skills work
---

### Installation flow

When a user asks the agent to install a skill, the `installSkill` tool triggers this sequence:

1. The source string (e.g., `"owner/repo"` or `"owner/repo/skill-name"`) is parsed into GitHub coordinates
2. `fetchSkillFromGitHub()` tries multiple URL patterns against raw.githubusercontent.com:
   - `owner/repo/main/SKILL.md`
   - `owner/repo/main/skills/SKILL.md`
   - `owner/repo/main/<path>/SKILL.md`
   - `owner/repo/main/skills/<path>/SKILL.md`
3. The fetched markdown is parsed by `parseSkillMd()`, which extracts YAML frontmatter and body
4. The skill is saved to the database as a plugin record with `sourceType: "skills"`
5. The markdown body is stored in the `plugin_config` table under the key `"content"`
6. The registry cache is cleared so the next request picks up the new skill

### SKILL.md format

A SKILL.md file has YAML frontmatter followed by a markdown body:

```markdown
---
name: "My Skill"
description: "What this skill teaches the agent"
allowedTools: "queryData, navigateTo"
userInvocable: true
---

The actual prompt content that gets injected into
the agent's system prompt goes here.
```

The frontmatter fields:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Display name for the skill |
| `description` | no | Brief description |
| `allowedTools` | no | Comma-separated list of tools this skill expects to use |
| `userInvocable` | no | Whether users can invoke this skill directly |

The parser (`parseSkillMd`) is intentionally lenient with YAML - it handles both quoted and unquoted values, normalizes key casing, and stores unknown frontmatter keys in a metadata bag.

### Prompt injection at priority 80

When the registry builds, skills become `PluginModule` objects with a single prompt section:

```typescript
const mod: PluginModule = {
  manifest: { /* ... */ },
  promptSections: [{
    heading: row.name,
    content: configRow.value,  // the SKILL.md body
    priority: 80,
  }],
}
```

Priority 80 means skills inject after the core system prompt (which uses lower priorities) but before any high-priority overrides. The registry's `getPromptSections()` sorts all sections by priority, so skills slot into a predictable position.


Plugin architecture
---

### Capabilities

Plugins declare what they contribute:

```typescript
export const PLUGIN_CAPABILITIES = [
  "tools",       // new tool calls for the agent
  "actions",     // client-side action handlers
  "components",  // UI components for dynamic rendering
  "prompt",      // system prompt sections
  "queries",     // new query types for the queryData tool
] as const
```

### PluginManifest

Every plugin declares a manifest:

```typescript
export interface PluginManifest {
  readonly id: string              // kebab-case identifier
  readonly name: string
  readonly description: string
  readonly version: SemVer         // branded string type, validated by isSemVer()
  readonly capabilities: ReadonlyArray<PluginCapability>
  readonly requiredEnvVars?: ReadonlyArray<string>
  readonly optionalEnvVars?: ReadonlyArray<string>
  readonly dependencies?: ReadonlyArray<string>
  readonly author?: string
}
```

The loader validates manifests strictly: `id` must be kebab-case, `version` must be valid semver, and capabilities must be from the known set. Missing required env vars cause the plugin to be silently skipped during registry build (not errored) - this prevents a misconfigured plugin from breaking the entire agent.

### PluginModule

The runtime shape a full plugin exports:

```typescript
export interface PluginModule {
  readonly manifest: PluginManifest
  readonly tools?: Readonly<Record<string, unknown>>
  readonly promptSections?: ReadonlyArray<PromptSection>
  readonly components?: ReadonlyArray<PluginComponent>
  readonly queryTypes?: ReadonlyArray<PluginQueryType>
  readonly actionHandlers?: ReadonlyArray<PluginActionHandler>
  readonly onEnable?: (ctx: PluginContext) => Promise<PluginResult>
  readonly onDisable?: (ctx: PluginContext) => Promise<void>
}
```

Lifecycle hooks (`onEnable`/`onDisable`) receive a context with the database, environment variables, and current user ID. The `onEnable` hook returns a `PluginResult` so it can report failures.


Plugin registry
---

The registry (`src/lib/agent/plugins/registry.ts`) aggregates all enabled plugins into a single interface:

```typescript
interface PluginRegistry {
  readonly plugins: ReadonlyMap<string, PluginModule>
  getTools(): Readonly<Record<string, unknown>>
  getPromptSections(): ReadonlyArray<PromptSection>
  getComponents(): ReadonlyArray<PluginComponent>
  getQueryTypes(): ReadonlyArray<PluginQueryType>
  getActionHandlers(): ReadonlyArray<PluginActionHandler>
}
```

### Build process

`buildRegistry()` queries all enabled plugin rows from the database, then for each:

1. **Skills**: loads the `"content"` config value and wraps it as a PluginModule with a prompt section at priority 80
2. **Builtin/local/npm**: calls `loadPluginModule()` which validates the manifest and checks required env vars

The result is a `Map<string, PluginModule>` wrapped in a registry object that provides accessor methods. These methods merge contributions from all plugins - `getTools()` combines all tool definitions, `getPromptSections()` collects and sorts all prompt injections, etc.

### 30-second TTL cache

The registry is cached per worker isolate with a 30-second TTL:

```typescript
let cached: {
  readonly registry: PluginRegistry
  readonly expiresAt: number
} | null = null

const TTL_MS = 30_000

export async function getRegistry(
  db: DbClient,
  env: Readonly<Record<string, string>>,
): Promise<PluginRegistry> {
  const now = Date.now()
  if (cached && now < cached.expiresAt) {
    return cached.registry
  }
  const registry = await buildRegistry(db, env)
  cached = { registry, expiresAt: now + TTL_MS }
  return registry
}
```

This means installing or toggling a skill takes effect within 30 seconds, or immediately if `clearRegistryCache()` is called (which all the skill management actions do). The cache is per-isolate, so different Workers instances have independent caches.


Agent tools for skill management
---

Four tools in `src/lib/agent/tools.ts` let the AI agent manage skills:

### installSkill

Installs a skill from GitHub. Takes a `source` string in `owner/repo` or `owner/repo/skill-name` format. Requires admin role. The tool description instructs the agent to always confirm with the user before installing.

### listInstalledSkills

Lists all installed skills with their status, source, and a content preview (first 200 characters of the prompt body).

### toggleInstalledSkill

Enables or disables an installed skill. Takes a `pluginId` and `enabled` boolean. Requires admin role.

### uninstallSkill

Permanently removes a skill. Deletes the plugin record, its config entries, and all event log entries. Requires admin role. The tool description instructs the agent to always confirm before uninstalling.

All four tools gate on `user.role !== "admin"` and return error messages for non-admin users.


Database tables
---

Three tables in `src/db/schema-plugins.ts`:

### plugins

The main registry of installed plugins and skills.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text (PK) | For skills: `"skill-"` + kebab-cased source path |
| `name` | text | Display name from manifest or SKILL.md frontmatter |
| `description` | text | Optional description |
| `version` | text | Semver string |
| `source` | text | Source identifier (GitHub path for skills, package name for npm) |
| `source_type` | text | One of: builtin, local, npm, skills |
| `capabilities` | text | Comma-separated capability list |
| `required_env_vars` | text | Comma-separated env var names (optional) |
| `status` | text | `enabled`, `disabled`, or `error`. Defaults to `disabled`. |
| `status_reason` | text | Explanation for error status (optional) |
| `enabled_by` | text (FK -> users) | Who enabled this plugin |
| `enabled_at` | text | When it was enabled |
| `installed_at` | text | When it was installed |
| `updated_at` | text | Last modification |

### plugin_config

Key-value configuration per plugin. For skills, this stores the SKILL.md body under the key `"content"` and optionally the allowed tools under `"allowedTools"`.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text (PK) | UUID |
| `plugin_id` | text (FK -> plugins, cascade) | Parent plugin |
| `key` | text | Config key |
| `value` | text | Config value |
| `is_encrypted` | integer (boolean) | Whether the value is encrypted. Defaults to false. |
| `updated_at` | text | Last modification |

### plugin_events

Audit log for plugin lifecycle events.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text (PK) | UUID |
| `plugin_id` | text (FK -> plugins, cascade) | Related plugin |
| `event_type` | text | One of: installed, enabled, disabled, configured, error |
| `details` | text | Human-readable description (e.g., "installed from owner/repo by user@email.com") |
| `user_id` | text (FK -> users) | Who triggered the event |
| `created_at` | text | When it happened |

Events cascade-delete with their parent plugin, so uninstalling a skill cleans up its entire audit trail.


Server actions
---

Five actions in `src/app/actions/plugins.ts`:

- `installSkill(source)` - fetches from GitHub, creates plugin + config + event records, clears cache
- `uninstallSkill(pluginId)` - deletes events, config, and plugin records (in that order), clears cache
- `toggleSkill(pluginId, enabled)` - updates status, logs event, clears cache
- `getInstalledSkills()` - lists all skills-type plugins with content previews

The `skillId()` helper converts a GitHub source path to a stable ID: `"owner/repo/name"` becomes `"skill-owner-repo-name"`. This ensures the same source always maps to the same plugin ID, preventing duplicate installs.

All actions follow the standard pattern: auth check, discriminated union return, `clearRegistryCache()` after mutations.
