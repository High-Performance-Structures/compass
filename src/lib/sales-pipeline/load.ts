import { and, eq, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { getProjects } from "@/app/actions/projects"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { resolveTown, spreadSharedTowns } from "@/lib/portfolio-map/model"
import { isProjectDepartment, type ProjectDepartment } from "@/lib/project-branding"
import { projectDisplayName } from "@/lib/project-display-name"
import {
  isDeliveryMethod,
  SALES_PIPELINE_DEPARTMENTS,
  salesStageForJobStatus,
  type DeliveryMethod,
  type SalesStageId,
} from "@/lib/sales-pipeline/stages"
import { isInternalStaffRole } from "@/lib/user-roles"

export type SalesPipelineJob = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly clientName: string | null
  readonly assignedTo: string | null
  readonly address: string | null
  readonly town: string | null
  /** Map position: the located site, else the town (fanned out when towns repeat). */
  readonly lon: number | null
  readonly lat: number | null
  readonly stage: SalesStageId
  readonly jobStatusId: string
  readonly statusLabel: string
  readonly deliveryMethod: DeliveryMethod | null
  readonly updatedAt: string | null
}

export type SalesPipeline = {
  readonly department: ProjectDepartment
  readonly title: string
  readonly jobs: readonly SalesPipelineJob[]
}

/**
 * Open jobs of the material-sales departments, by sales stage. Office staff
 * only; jobs come from the viewer's visible projects, so project access rules
 * still apply.
 */
export async function getSalesPipelines(): Promise<readonly SalesPipeline[]> {
  try {
    const user = await getCurrentUser()
    if (!user?.organizationId || !isInternalStaffRole(user.role)) return []
    const departments = Object.keys(SALES_PIPELINE_DEPARTMENTS).filter(isProjectDepartment)
    if (departments.length === 0) return []

    const visible = await getProjects()
    const staged = visible.flatMap((project) => {
      const stage = salesStageForJobStatus(project.jobStatusId)
      return stage ? [{ project, stage }] : []
    })
    if (staged.length === 0) return []

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []
    const db = getDb(env.DB)
    const details = await db
      .select({
        id: projects.id,
        department: projects.department,
        address: projects.address,
        publicLocationCity: projects.publicLocationCity,
        projectManager: projects.projectManager,
        deliveryMethod: projects.deliveryMethod,
        updatedAt: projects.updatedAt,
        siteLatitude: projects.siteLatitude,
        siteLongitude: projects.siteLongitude,
        siteLocationAddress: projects.siteLocationAddress,
        siteLocationStatus: projects.siteLocationStatus,
      })
      .from(projects)
      .where(and(eq(projects.organizationId, user.organizationId), inArray(projects.department, departments)))
    const detailById = new Map(details.map((row) => [row.id, row]))

    return departments.flatMap((department): SalesPipeline[] => {
      const title = SALES_PIPELINE_DEPARTMENTS[department]
      if (!title) return []
      const jobs = staged.flatMap(({ project, stage }): SalesPipelineJob[] => {
        const detail = detailById.get(project.id)
        if (!detail || detail.department !== department) return []
        const town = resolveTown({
          publicLocationCity: detail.publicLocationCity,
          address: detail.address,
          name: project.name,
        })
        return [{
          id: project.id,
          name: projectDisplayName(project),
          projectNumber: project.projectNumber,
          clientName: project.clientName,
          assignedTo: detail.projectManager,
          address: detail.address,
          town: town?.town ?? null,
          lon: town?.lon ?? null,
          lat: town?.lat ?? null,
          stage,
          jobStatusId: project.jobStatusId,
          statusLabel: project.jobStatusLabel,
          deliveryMethod: isDeliveryMethod(detail.deliveryMethod) ? detail.deliveryMethod : null,
          updatedAt: detail.updatedAt,
        }]
      })
      const placed = spreadSharedTowns(jobs).map((job) => {
        const detail = detailById.get(job.id)
        const siteFound =
          detail?.siteLocationStatus === "found" &&
          detail.siteLocationAddress === (detail.address?.trim() ?? "") &&
          detail.siteLatitude !== null &&
          detail.siteLongitude !== null
        return siteFound ? { ...job, lat: detail.siteLatitude, lon: detail.siteLongitude } : job
      })
      return placed.length > 0 ? [{ department, title, jobs: placed }] : []
    })
  } catch (error) {
    console.error("Sales pipeline data failed", error)
    return []
  }
}
