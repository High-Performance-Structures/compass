import "server-only"

import { and, desc, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { customDashboards } from "@/db/schema-dashboards"
import { isDemoUser } from "@/lib/demo"

// User-scoped dashboard operations shared by the dashboard server actions
// (user from the session cookie) and the agent dashboard API (user from a
// verified agent token). Never export these from a "use server" module: a
// server action taking a userId would let any browser act as any user.

type Db = ReturnType<typeof getDb>

export async function listCustomDashboardsForUser(
  db: Db,
  userId: string,
): Promise<
  ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly description: string
    readonly updatedAt: string
  }>
> {
  return db.query.customDashboards.findMany({
    where: (d, { eq: e }) => e(d.userId, userId),
    orderBy: (d) => desc(d.updatedAt),
    columns: {
      id: true,
      name: true,
      description: true,
      updatedAt: true,
    },
  })
}

export async function getCustomDashboardForUser(
  db: Db,
  userId: string,
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
  const dashboard = await db.query.customDashboards.findFirst({
    where: (d, { eq: e, and: a }) =>
      a(e(d.id, dashboardId), e(d.userId, userId)),
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

export async function deleteCustomDashboardForUser(
  db: Db,
  userId: string,
  dashboardId: string,
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  if (isDemoUser(userId)) {
    return { success: false, error: "DEMO_READ_ONLY" }
  }

  const existing = await db.query.customDashboards.findFirst({
    where: (d, { eq: e, and: a }) =>
      a(e(d.id, dashboardId), e(d.userId, userId)),
  })
  if (!existing) {
    return { success: false, error: "dashboard not found" }
  }

  await db
    .delete(customDashboards)
    .where(
      and(
        eq(customDashboards.id, dashboardId),
        eq(customDashboards.userId, userId),
      ),
    )

  return { success: true }
}
