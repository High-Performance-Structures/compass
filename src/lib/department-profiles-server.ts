import { cache } from "react"
import { getDb } from "@/db"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import type { DepartmentProfiles } from "@/lib/department-profiles"
import { DEFAULT_DEPARTMENT_PROFILES } from "@/lib/department-profiles"
import { readFeatureSettings } from "@/lib/feature-settings/server"

/**
 * The company's department profiles (Settings → Company → Departments), with
 * the built-in defaults when nothing is saved or the settings can't be read.
 */
export async function readDepartmentProfiles(
  db: ReturnType<typeof getDb>,
  organizationId: string | null | undefined,
): Promise<DepartmentProfiles> {
  if (!organizationId) return DEFAULT_DEPARTMENT_PROFILES
  try {
    return (await readFeatureSettings(db, organizationId, "department-profiles")).departments
  } catch (error) {
    console.error("Department profiles unavailable; using defaults", error instanceof Error ? error.message : error)
    return DEFAULT_DEPARTMENT_PROFILES
  }
}

/**
 * Profiles for the signed-in user's company, once per request. For server
 * pages and actions that render documents, emails or print views.
 */
export const currentDepartmentProfiles = cache(async (): Promise<DepartmentProfiles> => {
  try {
    const user = await getCurrentUser()
    const { env } = await getCloudflareContext()
    if (!env?.DB) return DEFAULT_DEPARTMENT_PROFILES
    return await readDepartmentProfiles(getDb(env.DB), user?.organizationId)
  } catch {
    return DEFAULT_DEPARTMENT_PROFILES
  }
})
