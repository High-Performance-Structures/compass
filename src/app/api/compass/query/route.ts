import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { validateAgentAuth } from "@/lib/agent/api-auth"
import {
  dailyLogs,
  ownerProjectUpdates,
  projectOperations,
  projectRfis,
  projects,
  scheduleTasks,
} from "@/db/schema"
import { invoices, vendorBills } from "@/db/schema-netsuite"
import { and, desc, eq, like, or } from "drizzle-orm"
import {
  canSearchCompassRole,
  dailyLogHref,
  ownerUpdateHref,
  projectHref,
  rfiHref,
} from "@/lib/jarvis/search"

export async function POST(req: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const envRecord = env as unknown as Record<string, string>

  const auth = await validateAgentAuth(req, envRecord)
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }
  if (!canSearchCompassRole(auth.role)) {
    return Response.json(
      { error: "Compass search is unavailable for this account" },
      { status: 403 }
    )
  }

  const db = getDb(env.DB)

  let body: {
    queryType: string
    id?: string
    search?: string
    limit?: number
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const orgId = auth.orgId
  const cap = Math.min(50, Math.max(1, body.limit ?? 20))

  try {
    switch (body.queryType) {
      case "customers": {
        const rows = await db.query.customers.findMany({
          limit: cap,
          where: (c, { eq: eqFunc, like: likeFunc, and: andFunc }) => {
            const conditions = [eqFunc(c.organizationId, orgId)]
            if (body.search) {
              conditions.push(likeFunc(c.name, `%${body.search}%`))
            }
            return conditions.length > 1
              ? andFunc(...conditions)
              : conditions[0]
          },
        })
        return new Response(
          JSON.stringify({ data: rows, count: rows.length }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "vendors": {
        const rows = await db.query.vendors.findMany({
          limit: cap,
          where: (v, { eq: eqFunc, like: likeFunc, and: andFunc }) => {
            const conditions = [eqFunc(v.organizationId, orgId)]
            if (body.search) {
              conditions.push(likeFunc(v.name, `%${body.search}%`))
            }
            return conditions.length > 1
              ? andFunc(...conditions)
              : conditions[0]
          },
        })
        return new Response(
          JSON.stringify({ data: rows, count: rows.length }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "projects": {
        const rows = await db.query.projects.findMany({
          limit: cap,
          where: (p, { eq: eqFunc, like: likeFunc, and: andFunc }) => {
            const conditions = [eqFunc(p.organizationId, orgId)]
            if (body.search) {
              const searchCondition = or(
                likeFunc(p.name, `%${body.search}%`),
                likeFunc(p.projectNumber, `%${body.search}%`)
              )
              if (searchCondition) {
                conditions.push(searchCondition)
              }
            }
            return conditions.length > 1
              ? andFunc(...conditions)
              : conditions[0]
          },
        })
        const data = rows.map((row) => ({
          ...row,
          href: projectHref(row.id),
        }))
        return new Response(
          JSON.stringify({ data, count: data.length }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "invoices": {
        const rows = await db
          .select({
            id: invoices.id,
            netsuiteId: invoices.netsuiteId,
            customerId: invoices.customerId,
            projectId: invoices.projectId,
            invoiceNumber: invoices.invoiceNumber,
            status: invoices.status,
            issueDate: invoices.issueDate,
            dueDate: invoices.dueDate,
            subtotal: invoices.subtotal,
            tax: invoices.tax,
            total: invoices.total,
            amountPaid: invoices.amountPaid,
            amountDue: invoices.amountDue,
            memo: invoices.memo,
            lineItems: invoices.lineItems,
            createdAt: invoices.createdAt,
            updatedAt: invoices.updatedAt,
          })
          .from(invoices)
          .innerJoin(projects, eq(invoices.projectId, projects.id))
          .where(eq(projects.organizationId, orgId))
          .limit(cap)
        return new Response(
          JSON.stringify({ data: rows, count: rows.length }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "vendor_bills": {
        const rows = await db
          .select({
            id: vendorBills.id,
            netsuiteId: vendorBills.netsuiteId,
            vendorId: vendorBills.vendorId,
            projectId: vendorBills.projectId,
            billNumber: vendorBills.billNumber,
            status: vendorBills.status,
            billDate: vendorBills.billDate,
            dueDate: vendorBills.dueDate,
            subtotal: vendorBills.subtotal,
            tax: vendorBills.tax,
            total: vendorBills.total,
            amountPaid: vendorBills.amountPaid,
            amountDue: vendorBills.amountDue,
            memo: vendorBills.memo,
            lineItems: vendorBills.lineItems,
            createdAt: vendorBills.createdAt,
            updatedAt: vendorBills.updatedAt,
          })
          .from(vendorBills)
          .innerJoin(projects, eq(vendorBills.projectId, projects.id))
          .where(eq(projects.organizationId, orgId))
          .limit(cap)
        return new Response(
          JSON.stringify({ data: rows, count: rows.length }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "schedule_tasks": {
        const whereConditions = [eq(projects.organizationId, orgId)]
        if (body.search) {
          whereConditions.push(like(scheduleTasks.title, `%${body.search}%`))
        }
        const rows = await db
          .select({
            id: scheduleTasks.id,
            projectId: scheduleTasks.projectId,
            title: scheduleTasks.title,
            startDate: scheduleTasks.startDate,
            workdays: scheduleTasks.workdays,
            endDateCalculated: scheduleTasks.endDateCalculated,
            phase: scheduleTasks.phase,
            status: scheduleTasks.status,
            isCriticalPath: scheduleTasks.isCriticalPath,
            isMilestone: scheduleTasks.isMilestone,
            percentComplete: scheduleTasks.percentComplete,
            assignedTo: scheduleTasks.assignedTo,
            sortOrder: scheduleTasks.sortOrder,
            createdAt: scheduleTasks.createdAt,
            updatedAt: scheduleTasks.updatedAt,
          })
          .from(scheduleTasks)
          .innerJoin(projects, eq(scheduleTasks.projectId, projects.id))
          .where(
            whereConditions.length > 1
              ? and(...whereConditions)
              : whereConditions[0]
          )
          .limit(cap)
        return new Response(
          JSON.stringify({ data: rows, count: rows.length }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "project_operations": {
        const whereConditions = [eq(projects.organizationId, orgId)]
        if (body.id) {
          whereConditions.push(eq(projectOperations.projectId, body.id))
        }
        if (body.search) {
          const search = `%${body.search}%`
          const searchCondition = or(
            like(projectOperations.title, search),
            like(projectOperations.sourceRecordNumber, search),
            like(projectOperations.companyName, search),
            like(projectOperations.assigneeName, search)
          )
          if (searchCondition) {
            whereConditions.push(searchCondition)
          }
        }
        const rows = await db
          .select({
            id: projectOperations.id,
            projectId: projectOperations.projectId,
            sourceSystem: projectOperations.sourceSystem,
            sourceRecordType: projectOperations.sourceRecordType,
            sourceRecordId: projectOperations.sourceRecordId,
            sourceRecordNumber: projectOperations.sourceRecordNumber,
            title: projectOperations.title,
            description: projectOperations.description,
            status: projectOperations.status,
            priority: projectOperations.priority,
            assigneeType: projectOperations.assigneeType,
            assigneeName: projectOperations.assigneeName,
            companyName: projectOperations.companyName,
            costCode: projectOperations.costCode,
            startDate: projectOperations.startDate,
            dueDate: projectOperations.dueDate,
            amount: projectOperations.amount,
            syncStatus: projectOperations.syncStatus,
            projectName: projects.name,
            projectNumber: projects.projectNumber,
          })
          .from(projectOperations)
          .innerJoin(projects, eq(projectOperations.projectId, projects.id))
          .where(
            whereConditions.length > 1
              ? and(...whereConditions)
              : whereConditions[0]
          )
          .limit(cap)
        return new Response(
          JSON.stringify({ data: rows, count: rows.length }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "daily_logs": {
        const whereConditions = [eq(projects.organizationId, orgId)]
        if (body.id) {
          whereConditions.push(eq(dailyLogs.projectId, body.id))
        }
        if (body.search) {
          const search = `%${body.search}%`
          const searchCondition = or(
            like(projects.name, search),
            like(projects.projectNumber, search),
            like(dailyLogs.workCompleted, search),
            like(dailyLogs.issues, search),
            like(dailyLogs.notes, search)
          )
          if (searchCondition) whereConditions.push(searchCondition)
        }
        const rows = await db
          .select({
            id: dailyLogs.id,
            projectId: dailyLogs.projectId,
            projectName: projects.name,
            projectNumber: projects.projectNumber,
            logDate: dailyLogs.logDate,
            workCompleted: dailyLogs.workCompleted,
            issues: dailyLogs.issues,
            notes: dailyLogs.notes,
            reviewStatus: dailyLogs.reviewStatus,
            isClientVisible: dailyLogs.isClientVisible,
          })
          .from(dailyLogs)
          .innerJoin(projects, eq(dailyLogs.projectId, projects.id))
          .where(and(...whereConditions))
          .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.updatedAt))
          .limit(cap)
        const data = rows.map((row) => ({
          ...row,
          href: dailyLogHref(row.projectId, row.id),
        }))
        return Response.json({ data, count: data.length })
      }

      case "owner_updates": {
        const whereConditions = [eq(projects.organizationId, orgId)]
        if (body.id) {
          whereConditions.push(eq(ownerProjectUpdates.projectId, body.id))
        }
        if (body.search) {
          const search = `%${body.search}%`
          const searchCondition = or(
            like(projects.name, search),
            like(projects.projectNumber, search),
            like(ownerProjectUpdates.title, search),
            like(ownerProjectUpdates.summary, search)
          )
          if (searchCondition) whereConditions.push(searchCondition)
        }
        const rows = await db
          .select({
            id: ownerProjectUpdates.id,
            projectId: ownerProjectUpdates.projectId,
            projectName: projects.name,
            projectNumber: projects.projectNumber,
            title: ownerProjectUpdates.title,
            updateDate: ownerProjectUpdates.updateDate,
            summary: ownerProjectUpdates.summary,
            status: ownerProjectUpdates.status,
            periodStart: ownerProjectUpdates.periodStart,
            periodEnd: ownerProjectUpdates.periodEnd,
          })
          .from(ownerProjectUpdates)
          .innerJoin(projects, eq(ownerProjectUpdates.projectId, projects.id))
          .where(and(...whereConditions))
          .orderBy(
            desc(ownerProjectUpdates.updateDate),
            desc(ownerProjectUpdates.updatedAt)
          )
          .limit(cap)
        const data = rows.map((row) => ({
          ...row,
          href: ownerUpdateHref(row.projectId, row.id),
        }))
        return Response.json({ data, count: data.length })
      }

      case "rfis": {
        const whereConditions = [eq(projects.organizationId, orgId)]
        if (body.id) {
          whereConditions.push(eq(projectRfis.projectId, body.id))
        }
        if (body.search) {
          const search = `%${body.search}%`
          const searchCondition = or(
            like(projects.name, search),
            like(projects.projectNumber, search),
            like(projectRfis.rfiNumber, search),
            like(projectRfis.subject, search),
            like(projectRfis.question, search),
            like(projectRfis.answer, search)
          )
          if (searchCondition) whereConditions.push(searchCondition)
        }
        const rows = await db
          .select({
            id: projectRfis.id,
            projectId: projectRfis.projectId,
            projectName: projects.name,
            projectNumber: projects.projectNumber,
            rfiNumber: projectRfis.rfiNumber,
            subject: projectRfis.subject,
            question: projectRfis.question,
            answer: projectRfis.answer,
            status: projectRfis.status,
            dueDate: projectRfis.dueDate,
            submittedAt: projectRfis.submittedAt,
          })
          .from(projectRfis)
          .innerJoin(projects, eq(projectRfis.projectId, projects.id))
          .where(and(...whereConditions))
          .orderBy(desc(projectRfis.submittedAt), desc(projectRfis.updatedAt))
          .limit(cap)
        const data = rows.map((row) => ({
          ...row,
          href: rfiHref(row.projectId, row.id),
        }))
        return Response.json({ data, count: data.length })
      }

      case "project_detail": {
        const queryId = body.id
        if (!queryId) {
          return new Response(
            JSON.stringify({ error: "id required for detail query" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }
        const row = await db.query.projects.findFirst({
          where: (p, { eq: eqFunc, and: andFunc }) =>
            andFunc(eqFunc(p.id, queryId), eqFunc(p.organizationId, orgId)),
        })
        if (!row) {
          return new Response(JSON.stringify({ error: "not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response(
          JSON.stringify({
            data: {
              ...row,
              href: projectHref(row.id),
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        )
      }

      case "customer_detail": {
        const queryId = body.id
        if (!queryId) {
          return new Response(
            JSON.stringify({ error: "id required for detail query" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }
        const row = await db.query.customers.findFirst({
          where: (c, { eq: eqFunc, and: andFunc }) =>
            andFunc(eqFunc(c.id, queryId), eqFunc(c.organizationId, orgId)),
        })
        if (!row) {
          return new Response(JSON.stringify({ error: "not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response(JSON.stringify({ data: row }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      case "vendor_detail": {
        const queryId = body.id
        if (!queryId) {
          return new Response(
            JSON.stringify({ error: "id required for detail query" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }
        const row = await db.query.vendors.findFirst({
          where: (v, { eq: eqFunc, and: andFunc }) =>
            andFunc(eqFunc(v.id, queryId), eqFunc(v.organizationId, orgId)),
        })
        if (!row) {
          return new Response(JSON.stringify({ error: "not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response(JSON.stringify({ data: row }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      default:
        return new Response(
          JSON.stringify({ error: "unknown query type" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        )
    }
  } catch (error) {
    console.error("Query endpoint error:", error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}
