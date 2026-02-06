// plugin capability categories
export const PLUGIN_CAPABILITIES = [
  "tools",
  "actions",
  "components",
  "prompt",
  "queries",
] as const

export type PluginCapability =
  (typeof PLUGIN_CAPABILITIES)[number]

// plugin status in database
export const PLUGIN_STATUSES = [
  "enabled",
  "disabled",
  "error",
] as const

export type PluginStatus = (typeof PLUGIN_STATUSES)[number]

// source types for plugin loading
export const PLUGIN_SOURCE_TYPES = [
  "builtin",
  "local",
  "npm",
  "skills",
] as const

export type PluginSourceType =
  (typeof PLUGIN_SOURCE_TYPES)[number]

// plugin event types for audit log
export const PLUGIN_EVENT_TYPES = [
  "installed",
  "enabled",
  "disabled",
  "configured",
  "error",
] as const

export type PluginEventType =
  (typeof PLUGIN_EVENT_TYPES)[number]

// semver string brand
type SemVer = string & { readonly __brand: "SemVer" }

// what a plugin declares about itself
export interface PluginManifest {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: SemVer
  readonly capabilities: ReadonlyArray<PluginCapability>
  readonly requiredEnvVars?: ReadonlyArray<string>
  readonly optionalEnvVars?: ReadonlyArray<string>
  readonly dependencies?: ReadonlyArray<string>
  readonly author?: string
}

// system prompt injection
export interface PromptSection {
  readonly heading: string
  readonly content: string
  readonly priority?: number
}

// component catalog entry contributed by a plugin
export interface PluginComponent {
  readonly type: string
  readonly description: string
  readonly props: Readonly<Record<string, unknown>>
}

// query type contributed by a plugin
export interface PluginQueryType {
  readonly name: string
  readonly description: string
}

// client-side action handler contributed by a plugin
export interface PluginActionHandler {
  readonly action: string
  readonly description: string
}

// runtime context passed to plugin lifecycle hooks
export interface PluginContext {
  readonly db: unknown
  readonly env: Readonly<Record<string, string>>
  readonly userId?: string
}

// result type for plugin operations
export type PluginResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

// the runtime module a plugin exports from index.ts
export interface PluginModule {
  readonly manifest: PluginManifest
  readonly tools?: Readonly<Record<string, unknown>>
  readonly promptSections?: ReadonlyArray<PromptSection>
  readonly components?: ReadonlyArray<PluginComponent>
  readonly queryTypes?: ReadonlyArray<PluginQueryType>
  readonly actionHandlers?: ReadonlyArray<PluginActionHandler>
  readonly onEnable?: (
    ctx: PluginContext,
  ) => Promise<PluginResult>
  readonly onDisable?: (ctx: PluginContext) => Promise<void>
}

// type guard for semver strings
export function isSemVer(value: string): value is SemVer {
  return /^\d+\.\d+\.\d+$/.test(value)
}

// skills.sh SKILL.md frontmatter
export interface SkillFrontmatter {
  readonly name: string
  readonly description: string
  readonly allowedTools?: string
  readonly userInvocable?: boolean
  readonly metadata?: Readonly<Record<string, unknown>>
}

// parsed SKILL.md file
export interface ParsedSkill {
  readonly frontmatter: SkillFrontmatter
  readonly body: string
}
