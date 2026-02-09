"use server"

import { getDb } from "@/lib/db-universal"
import { projects } from "@/db/schema"
import { asc } from "drizzle-orm"

export async function getProjects(): Promise<{ id: string; name: string }[]> {
  try {
    const db = await getDb()
    const allProjects = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .orderBy(asc(projects.name))

    return allProjects
  } catch {
    return []
  }
}

export async function createProject(data: {
  name: string
  client: string
  status: string
  description?: string
}): Promise<{ success: true; id: string } | { success: false; error: string }> {
  try {
    const db = await getDb()
    const id = crypto.randomUUID()

    await db.insert(projects).values({
      id,
      name: data.name,
      clientName: data.client, // mapped
      status: data.status.toUpperCase(), // OPEN, PENDING, ARCHIVED
      // description: data.description, // Removed as not in schema
      createdAt: new Date().toISOString(),
      // updatedAt: new Date().toISOString(), // Removed as not in schema
    })

    return { success: true, id }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create project",
    }
  }
}
