"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import {
  projectProfileAuditEvents,
  projectTravelChargeOverrides,
  projects,
  travelChargeSettings,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { resolveTown } from "@/lib/portfolio-map/model"
import {
  applyTravelOverride,
  EMPTY_TRAVEL_OVERRIDE,
  hasTravelOverride,
  travelChargeOverrideSchema,
  type EffectiveTravelCharge,
  type TravelChargeOverride,
} from "@/lib/portfolio-map/travel-overrides"
import {
  canEditTravelCharges,
  DEFAULT_TRAVEL_CHARGE_SETTINGS,
  jobTravelCharge,
  parseTravelChargeSettings,
  type TravelChargeSettings,
} from "@/lib/portfolio-map/travel-zones"
import { getProjectAccessRecord } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ProjectTravelChargeView = {
  readonly settings: TravelChargeSettings
  readonly override: TravelChargeOverride
  /** Null when the job has no town or site location yet. */
  readonly effective: EffectiveTravelCharge | null
  /** The job's charge from the defaults alone, for comparison. */
  readonly defaults: EffectiveTravelCharge | null
  readonly canEdit: boolean
  readonly updatedAt: string | null
}

type ActionResult = { readonly success: true } | { readonly success: false; readonly error: string }

type Db = ReturnType<typeof getDb>

/** Office staff with access to the project; editors as for Settings → Zone charges. */
async function context(projectId: string, action: "read" | "update") {
  const user = await requireAuth()
  await requireFeaturePermission(user, "project-hub", action)
  if (!isInternalStaffRole(user.role)) {
    throw new Error("Zone charges are available to office staff.")
  }
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  if (!env?.DB) throw new Error("Database unavailable")
  const db = getDb(env.DB)
  const access = await getProjectAccessRecord(db, user, projectId)
  if (!access || access.organizationId !== organizationId) {
    throw new Error("Project not found or access denied.")
  }
  const canEdit =
    user.isActive && canEditTravelCharges(user.role) && !isDemoUser(user.id) && !isDemoOrg(organizationId)
  return { db, organizationId, user, canEdit }
}

async function loadSettings(db: Db, organizationId: string): Promise<TravelChargeSettings> {
  const row = await db
    .select({ settingsJson: travelChargeSettings.settingsJson })
    .from(travelChargeSettings)
    .where(eq(travelChargeSettings.organizationId, organizationId))
    .limit(1)
    .then((rows) => rows[0])
  if (!row) return DEFAULT_TRAVEL_CHARGE_SETTINGS
  try {
    return parseTravelChargeSettings(JSON.parse(row.settingsJson))
  } catch {
    return DEFAULT_TRAVEL_CHARGE_SETTINGS
  }
}

async function loadOverride(db: Db, projectId: string, organizationId: string) {
  return db
    .select()
    .from(projectTravelChargeOverrides)
    .where(
      and(
        eq(projectTravelChargeOverrides.projectId, projectId),
        eq(projectTravelChargeOverrides.organizationId, organizationId),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

function toOverride(row: Awaited<ReturnType<typeof loadOverride>>): TravelChargeOverride {
  if (!row) return EMPTY_TRAVEL_OVERRIDE
  return {
    zoneIndex: row.zoneIndex,
    zoneRateCents: row.zoneRateCents,
    siteElevationFt: row.siteElevationFt,
    mountainRateCents: row.mountainRateCents,
    lodging: row.lodging,
    lodgingPerNightCents: row.lodgingPerNightCents,
    perDiemPerDayCents: row.perDiemPerDayCents,
    note: row.note,
  }
}

export async function getProjectTravelCharge(projectId: string): Promise<ProjectTravelChargeView | null> {
  try {
    const { db, organizationId, canEdit } = await context(projectId, "read")
    const [project, settings, row] = await Promise.all([
      db
        .select({
          name: projects.name,
          address: projects.address,
          publicLocationCity: projects.publicLocationCity,
          siteLatitude: projects.siteLatitude,
          siteLongitude: projects.siteLongitude,
          siteElevationFt: projects.siteElevationFt,
          siteLocationAddress: projects.siteLocationAddress,
          siteLocationStatus: projects.siteLocationStatus,
        })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      loadSettings(db, organizationId),
      loadOverride(db, projectId, organizationId),
    ])
    if (!project) return null
    const override = toOverride(row)
    // Same placement rule as the portfolio map: the located site when it still
    // matches the address, otherwise the town center (approximate).
    const site =
      project.siteLocationStatus === "found" &&
      project.siteLocationAddress === (project.address?.trim() ?? "") &&
      project.siteLatitude !== null &&
      project.siteLongitude !== null
        ? { lat: project.siteLatitude, lon: project.siteLongitude, elevationFt: project.siteElevationFt }
        : null
    const town = site ? null : resolveTown(project)
    const lat = site?.lat ?? town?.lat ?? null
    const lon = site?.lon ?? town?.lon ?? null
    let effective: EffectiveTravelCharge | null = null
    let defaults: EffectiveTravelCharge | null = null
    if (lat !== null && lon !== null) {
      const elevationFt = site?.elevationFt ?? null
      const base = { ...jobTravelCharge({ lat, lon, elevationFt, approximate: site === null, settings }), elevationFt }
      defaults = applyTravelOverride(base, null, settings)
      effective = applyTravelOverride(base, override, settings)
    }
    return { settings, override, effective, defaults, canEdit, updatedAt: row?.updatedAt ?? null }
  } catch (error) {
    console.error("Project zone charges failed", error)
    return null
  }
}

/** Save the job's adjustments; saving with nothing set removes them. */
export async function saveProjectTravelOverride(projectId: string, input: unknown): Promise<ActionResult> {
  try {
    const { db, organizationId, user, canEdit } = await context(projectId, "update")
    if (!canEdit) return { success: false, error: "Your role cannot change zone charges." }
    const parsed = travelChargeOverrideSchema.safeParse(input)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Check the zone charge values." }
    }
    const override = parsed.data
    const settings = await loadSettings(db, organizationId)
    if (override.zoneIndex !== null && override.zoneIndex >= settings.zones.length) {
      return { success: false, error: "Choose one of the current zones." }
    }
    const before = toOverride(await loadOverride(db, projectId, organizationId))
    const now = new Date().toISOString()
    const audit = db.insert(projectProfileAuditEvents).values({
      id: crypto.randomUUID(),
      organizationId,
      projectId,
      actorUserId: user.id,
      eventType: hasTravelOverride(override) ? "project_travel_charges_updated" : "project_travel_charges_cleared",
      entityType: "project_travel_charges",
      entityId: projectId,
      beforeJson: JSON.stringify(before),
      afterJson: JSON.stringify(override),
      createdAt: now,
    })
    if (!hasTravelOverride(override)) {
      await db.batch([
        db
          .delete(projectTravelChargeOverrides)
          .where(
            and(
              eq(projectTravelChargeOverrides.projectId, projectId),
              eq(projectTravelChargeOverrides.organizationId, organizationId),
            ),
          ),
        audit,
      ])
    } else {
      const values = { ...override, organizationId, updatedAt: now, updatedBy: user.id }
      await db.batch([
        db
          .insert(projectTravelChargeOverrides)
          .values({ projectId, ...values })
          .onConflictDoUpdate({ target: projectTravelChargeOverrides.projectId, set: values }),
        audit,
      ])
    }
    revalidatePath("/dashboard")
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    return { success: true }
  } catch (error) {
    console.error("Saving project zone charges failed", error)
    return { success: false, error: "Zone charges for this job could not be saved." }
  }
}

/** Remove every adjustment so the job follows the organization defaults again. */
export async function clearProjectTravelOverride(projectId: string): Promise<ActionResult> {
  return saveProjectTravelOverride(projectId, EMPTY_TRAVEL_OVERRIDE)
}
