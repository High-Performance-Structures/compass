"use server"

import { eq, and, desc } from "drizzle-orm"
import { getDb } from "@/lib/db-universal"
import { customDashboards } from "@/db/schema-dashboards"
import { getCurrentUser } from "@/lib/auth"
import { revalidatePath } from "next/cache"

const MAX_DASHBOARDS = 5

interface SavedQuery {
  readonly key: string
  readonly queryType: string
  readonly id?: string
  readonly search?: string
  readonly limit?: number
}

export async function getCustomDashboards(): Promise<
  | {
      readonly success: true
      readonly data: ReadonlyArray<{
        readonly id: string
        readonly name: string
        readonly description: string
        readonly updatedAt: string
      }>
    }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  const db = await getDb()

  const dashboards = await db.query.customDashboards.findMany({
    where: (d, { eq: e }) => e(d.userId, user.id),
    orderBy: (d) => desc(d.updatedAt),
    columns: {
      id: true,
      name: true,
      description: true,
      updatedAt: true,
    },
  })

  return { success: true, data: dashboards }
}

export async function getCustomDashboardById(
  dashboardId: string,
): Promise<
  | {
      readonly success: true
      readonly data: {
        readonly id: string
        readonly name: string
        readonly description: string
        readonly specData: string
        readonly queries: string
        readonly renderPrompt: string
        readonly updatedAt: string
      }
    }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  
  const db = await getDb()

  const dashboard = await db.query.customDashboards.findFirst({
    where: (d, { eq: e, and: a }) =>
      a(e(d.id, dashboardId), e(d.userId, user.id)),
  })

  if (!dashboard) {
    return { success: false, error: "dashboard not found" }
  }

  return {
    success: true,
    data: {
      id: dashboard.id,
      name: dashboard.name,
      description: dashboard.description,
      specData: dashboard.specData,
      queries: dashboard.queries,
      renderPrompt: dashboard.renderPrompt,
      updatedAt: dashboard.updatedAt,
    },
  }
}

export async function saveCustomDashboard(
  name: string,
  description: string,
  specData: string,
  queries: string,
  renderPrompt: string,
  existingId?: string,
): Promise<
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  
  const db = await getDb()

  const now = new Date().toISOString()
  const id = existingId ?? crypto.randomUUID()

  if (existingId) {
    const existing = await db.query.customDashboards.findFirst({
      where: (d, { eq: e, and: a }) =>
        a(e(d.id, existingId), e(d.userId, user.id)),
    })
    if (!existing) {
      return { success: false, error: "dashboard not found" }
    }
    await db
      .update(customDashboards)
      .set({
        name,
        description,
        specData,
        queries,
        renderPrompt,
        updatedAt: now,
      })
      .where(eq(customDashboards.id, existingId))
  } else {
    const count = await db.query.customDashboards.findMany({
      where: (d, { eq: e }) => e(d.userId, user.id),
      columns: { id: true },
    })
    if (count.length >= MAX_DASHBOARDS) {
      return {
        success: false,
        error: `Maximum of ${MAX_DASHBOARDS} dashboards reached. Delete one to create a new one.`,
      }
    }
    await db.insert(customDashboards).values({
      id,
      userId: user.id,
      name,
      description,
      specData,
      queries,
      renderPrompt,
      createdAt: now,
      updatedAt: now,
    })
  }

  revalidatePath("/", "layout")
  return { success: true, id }
}

export async function deleteCustomDashboard(
  dashboardId: string,
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  
  const db = await getDb()

  const existing = await db.query.customDashboards.findFirst({
    where: (d, { eq: e, and: a }) =>
      a(e(d.id, dashboardId), e(d.userId, user.id)),
  })
  if (!existing) {
    return { success: false, error: "dashboard not found" }
  }

  await db
    .delete(customDashboards)
    .where(
      and(
        eq(customDashboards.id, dashboardId),
        eq(customDashboards.userId, user.id),
      ),
    )

  revalidatePath("/", "layout")
  return { success: true }
}

export async function executeDashboardQueries(
  queriesJson: string,
): Promise<
  | {
      readonly success: true
      readonly data: Record<string, unknown>
    }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  
  const db = await getDb()

  let queries: ReadonlyArray<SavedQuery>
  try {
    queries = JSON.parse(queriesJson) as ReadonlyArray<SavedQuery>
  } catch {
    return { success: false, error: "invalid queries JSON" }
  }

  const dataContext: Record<string, unknown> = {}

  for (const q of queries) {
    const cap = q.limit ?? 20
    try {
      switch (q.queryType) {
        case "customers": {
          const rows = await db.query.customers.findMany({
            limit: cap,
            ...(q.search
              ? {
                  where: (c, { like }) =>
                    like(c.name, `%${q.search}%`),
                }
              : {}),
          })
          dataContext[q.key] = { data: rows, count: rows.length }
          break
        }
        case "vendors": {
          const rows = await db.query.vendors.findMany({
            limit: cap,
            ...(q.search
              ? {
                  where: (v, { like }) =>
                    like(v.name, `%${q.search}%`),
                }
              : {}),
          })
          dataContext[q.key] = { data: rows, count: rows.length }
          break
        }
        case "projects": {
          const rows = await db.query.projects.findMany({
            limit: cap,
            ...(q.search
              ? {
                  where: (p, { like }) =>
                    like(p.name, `%${q.search}%`),
                }
              : {}),
          })
          dataContext[q.key] = { data: rows, count: rows.length }
          break
        }
        case "invoices": {
          const rows = await db.query.invoices.findMany({
            limit: cap,
          })
          dataContext[q.key] = { data: rows, count: rows.length }
          break
        }
        case "vendor_bills": {
          const rows = await db.query.vendorBills.findMany({
            limit: cap,
          })
          dataContext[q.key] = { data: rows, count: rows.length }
          break
        }
        case "schedule_tasks": {
          const rows = await db.query.scheduleTasks.findMany({
            limit: cap,
            ...(q.search
              ? {
                  where: (t, { like }) =>
                    like(t.title, `%${q.search}%`),
                }
              : {}),
          })
          dataContext[q.key] = { data: rows, count: rows.length }
          break
        }
        case "project_detail": {
          if (q.id) {
            const row = await db.query.projects.findFirst({
              where: (p, { eq: e }) => e(p.id, q.id!),
            })
            dataContext[q.key] = row
              ? { data: row }
              : { error: "not found" }
          }
          break
        }
        case "customer_detail": {
          if (q.id) {
            const row = await db.query.customers.findFirst({
              where: (c, { eq: e }) => e(c.id, q.id!),
            })
            dataContext[q.key] = row
              ? { data: row }
              : { error: "not found" }
          }
          break
        }
        case "vendor_detail": {
          if (q.id) {
            const row = await db.query.vendors.findFirst({
              where: (v, { eq: e }) => e(v.id, q.id!),
            })
            dataContext[q.key] = row
              ? { data: row }
              : { error: "not found" }
          }
          break
        }
        default:
          dataContext[q.key] = { error: "unknown query type" }
      }
    } catch (err) {
      dataContext[q.key] = {
        error: err instanceof Error ? err.message : "query failed",
      }
    }
  }

  return { success: true, data: dataContext }
}
