/**
 * The only code that writes the settings and per-user preference tables
 * (architecture standard, section 1): company feature settings, AI provider
 * config, themes, custom dashboards, MCP keys, morning-plan preferences,
 * view preferences and saved project views, and push tokens. The desktop
 * offline mutation queue has its own client-safe store in ./offline-queue.
 * Callers resolve access first; nothing here checks
 * who is asking. Functions named `…Statement` return a statement for the
 * caller's `db.batch`, so writes that must land together stay in one batch.
 */
import { and, eq, or } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { DrizzleD1Database } from "drizzle-orm/d1"

import {
  morningPlanPreferences,
  organizationFeatureSettings,
  projectSavedViews,
  pushTokens,
  userViewPreferences,
} from "@/db/schema"
import { userProviderConfig } from "@/db/schema-ai-config"
import { customDashboards } from "@/db/schema-dashboards"
import { mcpApiKeys, type NewMcpApiKey } from "@/db/schema-mcp"
import { customThemes, userThemePreference } from "@/db/schema-theme"
import type { Db } from "@/lib/server/action-context"

type Statement = BatchItem<"sqlite">

// ---------------------------------------------------------------------------
// Company feature settings
// ---------------------------------------------------------------------------

type FeatureSettingValues = {
  readonly organizationId: string
  readonly featureKey: string
  readonly value: string
  readonly updatedBy: string
  readonly updatedAt: string
}

function featureSettingUpsert(db: Db, input: FeatureSettingValues) {
  const { value, updatedAt, updatedBy } = input
  return db
    .insert(organizationFeatureSettings)
    .values({ organizationId: input.organizationId, featureKey: input.featureKey, value, updatedAt, updatedBy })
    .onConflictDoUpdate({
      target: [organizationFeatureSettings.organizationId, organizationFeatureSettings.featureKey],
      set: { value, updatedAt, updatedBy },
    })
}

function featureSettingDelete(db: Db, organizationId: string, featureKey: string) {
  return db
    .delete(organizationFeatureSettings)
    .where(and(eq(organizationFeatureSettings.organizationId, organizationId), eq(organizationFeatureSettings.featureKey, featureKey)))
}

/** Saves (or replaces) a company's custom values for one feature. */
export async function saveOrganizationFeatureSetting(db: Db, input: FeatureSettingValues): Promise<void> {
  await featureSettingUpsert(db, input)
}

export function saveOrganizationFeatureSettingStatement(db: Db, input: FeatureSettingValues): Statement {
  return featureSettingUpsert(db, input)
}

/** Removes a company's custom values so the feature uses its defaults again. */
export async function deleteOrganizationFeatureSetting(db: Db, organizationId: string, featureKey: string): Promise<void> {
  await featureSettingDelete(db, organizationId, featureKey)
}

export function deleteOrganizationFeatureSettingStatement(db: Db, organizationId: string, featureKey: string): Statement {
  return featureSettingDelete(db, organizationId, featureKey)
}

// ---------------------------------------------------------------------------
// AI provider config
// ---------------------------------------------------------------------------

/** The user's chosen provider and (encrypted) key, replacing any earlier one. */
export async function saveUserProviderConfig(
  db: Db,
  input: {
    readonly userId: string
    readonly providerType: string
    readonly apiKey: string | null
    readonly baseUrl: string | null
    readonly modelOverrides: string | null
    readonly updatedAt: string
  },
): Promise<void> {
  const { userId, providerType, apiKey, baseUrl, modelOverrides, updatedAt } = input
  await db
    .insert(userProviderConfig)
    .values({ userId, providerType, apiKey, baseUrl, modelOverrides, isActive: 1, updatedAt })
    .onConflictDoUpdate({
      target: userProviderConfig.userId,
      set: { providerType, apiKey, baseUrl, modelOverrides, isActive: 1, updatedAt },
    })
    .run()
}

/**
 * Switches the user to Anthropic OAuth. An existing row keeps its model
 * overrides; a new row starts without any.
 */
export async function saveAnthropicOAuthProviderConfig(db: Db, userId: string, updatedAt: string): Promise<void> {
  await db
    .insert(userProviderConfig)
    .values({
      userId,
      providerType: "anthropic-oauth",
      apiKey: null,
      baseUrl: null,
      modelOverrides: null,
      isActive: 1,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: userProviderConfig.userId,
      set: { providerType: "anthropic-oauth", apiKey: null, baseUrl: null, isActive: 1, updatedAt },
    })
    .run()
}

export async function updateUserModelOverrides(db: Db, userId: string, modelOverrides: string, updatedAt: string): Promise<void> {
  await db
    .update(userProviderConfig)
    .set({ modelOverrides, updatedAt })
    .where(eq(userProviderConfig.userId, userId))
    .run()
}

export async function deleteUserProviderConfig(db: Db, userId: string): Promise<void> {
  await db.delete(userProviderConfig).where(eq(userProviderConfig.userId, userId)).run()
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export async function saveUserThemePreference(db: Db, userId: string, activeThemeId: string, updatedAt: string): Promise<void> {
  await db
    .insert(userThemePreference)
    .values({ userId, activeThemeId, updatedAt })
    .onConflictDoUpdate({
      target: userThemePreference.userId,
      set: { activeThemeId, updatedAt },
    })
}

/** Points the user's preference back at a preset (used when their theme is deleted). */
export async function resetUserThemePreference(db: Db, userId: string, activeThemeId: string, updatedAt: string): Promise<void> {
  await db
    .update(userThemePreference)
    .set({ activeThemeId, updatedAt })
    .where(eq(userThemePreference.userId, userId))
}

type CustomThemeContent = {
  readonly name: string
  readonly description: string
  readonly themeData: string
}

export async function insertCustomTheme(
  db: Db,
  input: CustomThemeContent & { readonly id: string; readonly userId: string; readonly now: string },
): Promise<void> {
  await db.insert(customThemes).values({
    id: input.id,
    userId: input.userId,
    name: input.name,
    description: input.description,
    themeData: input.themeData,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Updates a theme the user owns. */
export async function updateCustomTheme(
  db: Db,
  input: CustomThemeContent & { readonly id: string; readonly userId: string; readonly updatedAt: string },
): Promise<void> {
  const { name, description, themeData, updatedAt } = input
  await db
    .update(customThemes)
    .set({ name, description, themeData, updatedAt })
    .where(and(eq(customThemes.id, input.id), eq(customThemes.userId, input.userId)))
}

/** Deletes a theme the user owns. */
export async function deleteCustomTheme(db: Db, userId: string, themeId: string): Promise<void> {
  await db.delete(customThemes).where(and(eq(customThemes.id, themeId), eq(customThemes.userId, userId)))
}

// ---------------------------------------------------------------------------
// Custom dashboards
// ---------------------------------------------------------------------------

type CustomDashboardContent = {
  readonly name: string
  readonly description: string
  readonly specData: string
  readonly queries: string
  readonly renderPrompt: string
}

export async function insertCustomDashboard(
  db: Db,
  input: CustomDashboardContent & { readonly id: string; readonly userId: string; readonly now: string },
): Promise<void> {
  await db.insert(customDashboards).values({
    id: input.id,
    userId: input.userId,
    name: input.name,
    description: input.description,
    specData: input.specData,
    queries: input.queries,
    renderPrompt: input.renderPrompt,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Callers confirm the user owns the dashboard before updating it. */
export async function updateCustomDashboard(
  db: Db,
  dashboardId: string,
  input: CustomDashboardContent & { readonly updatedAt: string },
): Promise<void> {
  const { name, description, specData, queries, renderPrompt, updatedAt } = input
  await db
    .update(customDashboards)
    .set({ name, description, specData, queries, renderPrompt, updatedAt })
    .where(eq(customDashboards.id, dashboardId))
}

/** Deletes a dashboard the user owns. */
export async function deleteCustomDashboard(db: Db, userId: string, dashboardId: string): Promise<void> {
  await db.delete(customDashboards).where(and(eq(customDashboards.id, dashboardId), eq(customDashboards.userId, userId)))
}

// ---------------------------------------------------------------------------
// MCP API keys
// ---------------------------------------------------------------------------

export async function insertMcpApiKey(db: Db, row: NewMcpApiKey): Promise<void> {
  await db.insert(mcpApiKeys).values(row).run()
}

/** Callers confirm the user owns the key first. */
export async function revokeMcpApiKey(db: Db, keyId: string): Promise<void> {
  await db.update(mcpApiKeys).set({ isActive: false }).where(eq(mcpApiKeys.id, keyId)).run()
}

/** Callers confirm the user owns the key first. */
export async function deleteMcpApiKey(db: Db, keyId: string): Promise<void> {
  await db.delete(mcpApiKeys).where(eq(mcpApiKeys.id, keyId)).run()
}

/**
 * Records when a key was last used. Returns the pending write so the caller
 * can leave it running (fire-and-forget) and handle its failure.
 */
export function touchMcpApiKeyLastUsed(db: DrizzleD1Database<Record<string, unknown>>, keyId: string, lastUsedAt: string): Promise<unknown> {
  return db.update(mcpApiKeys).set({ lastUsedAt }).where(eq(mcpApiKeys.id, keyId)).run()
}

// ---------------------------------------------------------------------------
// Morning plan
// ---------------------------------------------------------------------------

type MorningPlanChange = {
  readonly digestEnabled?: boolean
  readonly digestHour?: number
  readonly lastDigestOn?: string
  readonly lastOverloadWeek?: string
}

/** Creates the person's preferences row or applies `change` to it. */
export async function upsertMorningPlanPreferences(
  db: Db,
  input: { readonly userId: string; readonly organizationId: string; readonly change: MorningPlanChange; readonly at: string },
): Promise<void> {
  const { userId, organizationId, change, at } = input
  await db
    .insert(morningPlanPreferences)
    .values({ userId, organizationId, ...change, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({ target: morningPlanPreferences.userId, set: { ...change, updatedAt: at } })
}

// ---------------------------------------------------------------------------
// View preferences and saved project views
// ---------------------------------------------------------------------------

function viewPreferenceDelete(db: Db, userId: string, viewKey: string) {
  return db.delete(userViewPreferences).where(and(eq(userViewPreferences.userId, userId), eq(userViewPreferences.viewKey, viewKey)))
}

function viewPreferenceUpsert(db: Db, input: { readonly userId: string; readonly viewKey: string; readonly value: string; readonly updatedAt: string }) {
  const { userId, viewKey, value, updatedAt } = input
  return db
    .insert(userViewPreferences)
    .values({ userId, viewKey, value, updatedAt })
    .onConflictDoUpdate({ target: [userViewPreferences.userId, userViewPreferences.viewKey], set: { value, updatedAt } })
}

/** Saves one per-user view setting (JSON value) under its view key. */
export async function saveUserViewPreference(
  db: Db,
  input: { readonly userId: string; readonly viewKey: string; readonly value: string; readonly updatedAt: string },
): Promise<void> {
  await viewPreferenceUpsert(db, input).run()
}

/** Clears one per-user view setting so the view falls back to its default. */
export async function deleteUserViewPreference(db: Db, userId: string, viewKey: string): Promise<void> {
  await viewPreferenceDelete(db, userId, viewKey).run()
}

type SavedViewRow = typeof projectSavedViews.$inferSelect

export async function insertProjectSavedView(db: Db, row: typeof projectSavedViews.$inferInsert): Promise<void> {
  await db.insert(projectSavedViews).values(row).run()
}

/**
 * Updates a view only when `ownerUserId` owns it in this organization.
 * Leaving `definition` undefined keeps the stored filters. Returns the
 * updated row, or undefined when nothing matched.
 */
export async function updateOwnedProjectSavedView(
  db: Db,
  input: {
    readonly id: string
    readonly organizationId: string
    readonly ownerUserId: string
    readonly name: string
    readonly visibility: "personal" | "shared"
    readonly definition?: string
    readonly updatedAt: string
  },
): Promise<SavedViewRow | undefined> {
  const { name, visibility, definition, updatedAt } = input
  return db
    .update(projectSavedViews)
    .set({ name, visibility, ...(definition === undefined ? {} : { definition }), updatedAt })
    .where(and(eq(projectSavedViews.id, input.id), eq(projectSavedViews.ownerUserId, input.ownerUserId), eq(projectSavedViews.organizationId, input.organizationId)))
    .returning()
    .get()
}

/** Deletes a view the user owns; returns its id, or undefined when nothing matched. */
export async function deleteOwnedProjectSavedView(
  db: Db,
  input: { readonly id: string; readonly organizationId: string; readonly ownerUserId: string },
): Promise<{ readonly id: string } | undefined> {
  return db
    .delete(projectSavedViews)
    .where(and(eq(projectSavedViews.id, input.id), eq(projectSavedViews.organizationId, input.organizationId), eq(projectSavedViews.ownerUserId, input.ownerUserId)))
    .returning({ id: projectSavedViews.id })
    .get()
}

/** Every view a person owns, personal and shared (account deletion). */
export function deleteProjectSavedViewsOwnedByStatement(db: Db, ownerUserId: string): Statement {
  return db.delete(projectSavedViews).where(eq(projectSavedViews.ownerUserId, ownerUserId))
}

// ---------------------------------------------------------------------------
// Push tokens
// ---------------------------------------------------------------------------

/**
 * A device token follows its current account after logout or account
 * switching. One batch, so a repeated registration can't race the unique
 * token index between the delete and the insert.
 */
export async function registerPushToken(
  db: Db,
  input: { readonly id: string; readonly userId: string; readonly token: string; readonly platform: string; readonly now: string },
): Promise<void> {
  const { id, userId, token, platform, now } = input
  await db.batch([
    db
      .delete(pushTokens)
      .where(
        or(
          eq(pushTokens.token, token),
          and(eq(pushTokens.userId, userId), eq(pushTokens.platform, platform)),
        ),
      ),
    db.insert(pushTokens).values({ id, userId, token, platform, createdAt: now, updatedAt: now }),
  ])
}

/** Removes one of the user's device tokens, or all of them (sign-out) when `token` is null. */
export async function deleteUserPushTokens(db: Db, userId: string, token: string | null): Promise<void> {
  if (token) {
    await db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)))
  } else {
    await db.delete(pushTokens).where(eq(pushTokens.userId, userId))
  }
}

/** A provider reported the token invalid; stop sending to it. */
export async function deletePushToken(db: Db, tokenId: string): Promise<void> {
  await db.delete(pushTokens).where(eq(pushTokens.id, tokenId))
}
