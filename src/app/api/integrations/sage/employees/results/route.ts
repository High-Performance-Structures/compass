import { z } from "zod/v4"

import { readBoundedSageBridgeBody } from "@/lib/sage/bridge-auth"
import { EMPLOYEE_READER, authorizeSageChangeOrderBridge } from "@/lib/sage/change-order-bridge"
import { applySageEmployeeDirectory } from "@/lib/sage/employee-directory-sync"

const MAX_EMPLOYEE_BYTES = 2 * 1024 * 1024
const optionalText = (max: number) => z.string().max(max).nullable().transform((value) => value?.trim() || null)
const snapshotSchema = z.strictObject({
  capturedAt: z.iso.datetime({ offset: true }),
  employees: z
    .array(
      z.strictObject({
        // dbo.employ._idnum (GUID) and recnum.
        sageRecordId: z.guid(),
        sageEmployeeNumber: z.string().regex(/^[1-9]\d{0,9}$/),
        firstName: optionalText(100),
        lastName: optionalText(100),
        email: optionalText(255),
        // dbo.employ.status (1 = current) and inactv.
        status: z.number().int().nullable(),
        inactive: z.boolean(),
      })
    )
    .min(1)
    .max(5000),
})

/**
 * The read-only Sage reader sends Sage's complete employee list. Compass
 * stores it, links unlinked staff by email, and sets linked staff contacts
 * active or inactive to match Sage, as the company's settings allow.
 */
export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 })
  }
  const body = await readBoundedSageBridgeBody(request, MAX_EMPLOYEE_BYTES)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const bridge = await authorizeSageChangeOrderBridge(request, body.rawBody, EMPLOYEE_READER)
  if (!bridge.success) return bridge.response
  let raw: unknown
  try {
    raw = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = snapshotSchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid employee snapshot" }, { status: 400 })
  const employees = parsed.data.employees
  const ids = new Set(employees.map((employee) => employee.sageRecordId.toLowerCase()))
  const numbers = new Set(employees.map((employee) => employee.sageEmployeeNumber))
  if (ids.size !== employees.length || numbers.size !== employees.length) {
    return Response.json({ error: "Duplicate Sage employee in the list" }, { status: 400 })
  }
  const rows = employees.map((employee) => ({
    sageRecordId: employee.sageRecordId.toLowerCase(),
    sageEmployeeNumber: employee.sageEmployeeNumber,
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email?.toLowerCase() ?? null,
    sageStatusCode: employee.status,
    inactive: employee.inactive,
  }))
  const summary = await applySageEmployeeDirectory(bridge.db, bridge.env.DB, bridge.organizationId, rows, new Date().toISOString())
  return Response.json({ success: true, ...summary })
}
