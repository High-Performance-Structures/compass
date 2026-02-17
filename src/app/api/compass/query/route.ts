import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { validateAgentAuth } from "@/lib/agent/api-auth"
import { projects, scheduleTasks } from "@/db/schema"
import { invoices, vendorBills } from "@/db/schema-netsuite"
import { eq, and, like } from "drizzle-orm"

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
  const cap = body.limit ?? 20

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
              conditions.push(likeFunc(p.name, `%${body.search}%`))
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

      case "project_detail": {
        if (!body.id) {
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
            andFunc(eqFunc(p.id, body.id!), eqFunc(p.organizationId, orgId)),
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

      case "customer_detail": {
        if (!body.id) {
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
            andFunc(eqFunc(c.id, body.id!), eqFunc(c.organizationId, orgId)),
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
        if (!body.id) {
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
            andFunc(eqFunc(v.id, body.id!), eqFunc(v.organizationId, orgId)),
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
