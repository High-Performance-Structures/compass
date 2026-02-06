"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import {
  plugins,
  pluginConfig,
  pluginEvents,
} from "@/db/schema-plugins"
import { getCurrentUser } from "@/lib/auth"
import { fetchSkillFromGitHub } from "@/lib/agent/plugins/skills-client"
import { clearRegistryCache } from "@/lib/agent/plugins/registry"

function skillId(source: string): string {
  return "skill-" + source.replace(/\//g, "-").toLowerCase()
}

export async function installSkill(source: string): Promise<
  | { readonly success: true; readonly plugin: { readonly id: string; readonly name: string } }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const id = skillId(source)
  const now = new Date().toISOString()

  const existing = await db.query.plugins.findFirst({
    where: (p, { eq: e }) => e(p.id, id),
  })
  if (existing) {
    return {
      success: false,
      error: `skill "${source}" is already installed`,
    }
  }

  const result = await fetchSkillFromGitHub(source)
  if (!result.success) {
    return { success: false, error: result.error }
  }

  const { frontmatter, body } = result.skill

  await db.insert(plugins).values({
    id,
    name: frontmatter.name,
    description: frontmatter.description,
    version: "1.0.0",
    source,
    sourceType: "skills",
    capabilities: "prompt",
    status: "enabled",
    enabledBy: user.id,
    enabledAt: now,
    installedAt: now,
    updatedAt: now,
  })

  await db.insert(pluginConfig).values({
    id: crypto.randomUUID(),
    pluginId: id,
    key: "content",
    value: body,
    updatedAt: now,
  })

  if (frontmatter.allowedTools) {
    await db.insert(pluginConfig).values({
      id: crypto.randomUUID(),
      pluginId: id,
      key: "allowedTools",
      value: frontmatter.allowedTools,
      updatedAt: now,
    })
  }

  await db.insert(pluginEvents).values({
    id: crypto.randomUUID(),
    pluginId: id,
    eventType: "installed",
    details: `installed from ${source} by ${user.email}`,
    userId: user.id,
    createdAt: now,
  })

  clearRegistryCache()

  return {
    success: true,
    plugin: { id, name: frontmatter.name },
  }
}

export async function uninstallSkill(pluginId: string): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db.query.plugins.findFirst({
    where: (p, { eq: e }) => e(p.id, pluginId),
  })
  if (!existing) {
    return { success: false, error: "skill not found" }
  }

  await db
    .delete(pluginEvents)
    .where(eq(pluginEvents.pluginId, pluginId))
  await db
    .delete(pluginConfig)
    .where(eq(pluginConfig.pluginId, pluginId))
  await db
    .delete(plugins)
    .where(eq(plugins.id, pluginId))

  clearRegistryCache()
  return { success: true }
}

export async function toggleSkill(
  pluginId: string,
  enabled: boolean,
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const now = new Date().toISOString()

  const existing = await db.query.plugins.findFirst({
    where: (p, { eq: e }) => e(p.id, pluginId),
  })
  if (!existing) {
    return { success: false, error: "skill not found" }
  }

  const status = enabled ? "enabled" : "disabled"

  await db
    .update(plugins)
    .set({
      status,
      enabledBy: enabled ? user.id : null,
      enabledAt: enabled ? now : null,
      updatedAt: now,
    })
    .where(eq(plugins.id, pluginId))

  await db.insert(pluginEvents).values({
    id: crypto.randomUUID(),
    pluginId,
    eventType: status,
    details: `${status} by ${user.email}`,
    userId: user.id,
    createdAt: now,
  })

  clearRegistryCache()
  return { success: true }
}

interface InstalledSkill {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly source: string
  readonly status: string
  readonly installedAt: string
  readonly contentPreview: string | null
}

export async function getInstalledSkills(): Promise<
  | {
      readonly success: true
      readonly skills: ReadonlyArray<InstalledSkill>
    }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const rows = await db
    .select()
    .from(plugins)
    .where(eq(plugins.sourceType, "skills"))

  const skills: Array<InstalledSkill> = []

  for (const row of rows) {
    const configRow = await db.query.pluginConfig.findFirst({
      where: (c, { and: a, eq: e }) =>
        a(e(c.pluginId, row.id), e(c.key, "content")),
    })

    skills.push({
      id: row.id,
      name: row.name,
      description: row.description,
      source: row.source,
      status: row.status,
      installedAt: row.installedAt,
      contentPreview: configRow
        ? configRow.value.slice(0, 200)
        : null,
    })
  }

  return { success: true, skills }
}
