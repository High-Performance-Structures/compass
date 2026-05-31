"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { mcpServers } from "@/db/schema-mcp"
import type { McpServer } from "@/db/schema-mcp"
import { eq, and } from "drizzle-orm"
import { getCurrentUser } from "@/lib/auth"
import { revalidatePath } from "next/cache"

type CreateMcpServerData = {
  readonly name: string
  readonly slug: string
  readonly transport: string
  readonly command?: string
  readonly args?: string
  readonly env?: string
  readonly url?: string
  readonly headers?: string
}

type UpdateMcpServerData = Partial<CreateMcpServerData>

export async function getMcpServers(): Promise<
  | { success: true; data: ReadonlyArray<McpServer> }
  | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }
    if (!user.organizationId) return { success: false, error: "No organization" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const rows = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.orgId, user.organizationId))
      .all()

    return { success: true, data: rows }
  } catch (error) {
    console.error("getMcpServers failed:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function createMcpServer(
  data: CreateMcpServerData
): Promise<{ success: true; data: McpServer } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }
    if (!user.organizationId) return { success: false, error: "No organization" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const row: McpServer = {
      id: crypto.randomUUID(),
      orgId: user.organizationId,
      name: data.name,
      slug: data.slug,
      transport: data.transport,
      command: data.command ?? null,
      args: data.args ?? null,
      env: data.env ?? null,
      url: data.url ?? null,
      headers: data.headers ?? null,
      isEnabled: true,
      createdAt: new Date().toISOString(),
      createdBy: user.id,
    }

    await db.insert(mcpServers).values(row).run()
    revalidatePath("/dashboard/settings")

    return { success: true, data: row }
  } catch (error) {
    console.error("createMcpServer failed:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function updateMcpServer(
  id: string,
  data: UpdateMcpServerData
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }
    if (!user.organizationId) return { success: false, error: "No organization" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(and(eq(mcpServers.id, id), eq(mcpServers.orgId, user.organizationId)))
      .get()

    if (!existing) return { success: false, error: "Server not found" }

    await db.update(mcpServers).set(data).where(eq(mcpServers.id, id)).run()
    revalidatePath("/dashboard/settings")

    return { success: true }
  } catch (error) {
    console.error("updateMcpServer failed:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function deleteMcpServer(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }
    if (!user.organizationId) return { success: false, error: "No organization" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(and(eq(mcpServers.id, id), eq(mcpServers.orgId, user.organizationId)))
      .get()

    if (!existing) return { success: false, error: "Server not found" }

    await db.delete(mcpServers).where(eq(mcpServers.id, id)).run()
    revalidatePath("/dashboard/settings")

    return { success: true }
  } catch (error) {
    console.error("deleteMcpServer failed:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function toggleMcpServer(
  id: string,
  enabled: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }
    if (!user.organizationId) return { success: false, error: "No organization" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(and(eq(mcpServers.id, id), eq(mcpServers.orgId, user.organizationId)))
      .get()

    if (!existing) return { success: false, error: "Server not found" }

    await db
      .update(mcpServers)
      .set({ isEnabled: enabled })
      .where(eq(mcpServers.id, id))
      .run()
    revalidatePath("/dashboard/settings")

    return { success: true }
  } catch (error) {
    console.error("toggleMcpServer failed:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
