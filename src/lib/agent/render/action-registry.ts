import { z } from "zod"
import type { AuthUser } from "@/lib/auth"
import {
  can,
  type Resource,
  type Action,
} from "@/lib/permissions"

type ActionResult =
  | { readonly success: true; readonly data?: unknown }
  | { readonly success: false; readonly error: string }

interface ActionDefinition {
  readonly schema: z.ZodType
  readonly resource?: Resource
  readonly permission?: Action
  readonly execute: (
    params: Record<string, unknown>,
    userId: string
  ) => Promise<ActionResult>
}

const customerSchema = z.object({
  name: z.string().min(1),
  company: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
})

const customerUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  company: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
})

const deleteSchema = z.object({
  id: z.string().min(1),
})

const vendorSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
})

const vendorUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  category: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
})

const invoiceSchema = z.object({
  number: z.string().min(1),
  customerId: z.string().min(1),
  projectId: z.string().optional(),
  amount: z.number(),
  dueDate: z.string(),
  status: z
    .enum(["draft", "sent", "paid", "overdue"])
    .optional(),
})

const invoiceUpdateSchema = z.object({
  id: z.string().min(1),
  number: z.string().optional(),
  customerId: z.string().optional(),
  projectId: z.string().optional(),
  amount: z.number().optional(),
  dueDate: z.string().optional(),
  status: z
    .enum(["draft", "sent", "paid", "overdue"])
    .optional(),
})

const vendorBillSchema = z.object({
  number: z.string().min(1),
  vendorId: z.string().min(1),
  projectId: z.string().optional(),
  amount: z.number(),
  dueDate: z.string(),
  status: z
    .enum(["draft", "received", "paid", "overdue"])
    .optional(),
})

const vendorBillUpdateSchema = z.object({
  id: z.string().min(1),
  number: z.string().optional(),
  vendorId: z.string().optional(),
  projectId: z.string().optional(),
  amount: z.number().optional(),
  dueDate: z.string().optional(),
  status: z
    .enum(["draft", "received", "paid", "overdue"])
    .optional(),
})

const scheduleCreateSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  startDate: z.string(),
  workdays: z.number().int().positive(),
  phase: z.string(),
  isMilestone: z.boolean().optional(),
  percentComplete: z.number().optional(),
  assignedTo: z.string().optional(),
})

const scheduleUpdateSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    startDate: z.string().optional(),
    workdays: z.number().int().positive().optional(),
    phase: z.string().optional(),
    isMilestone: z.boolean().optional(),
    percentComplete: z.number().optional(),
    assignedTo: z.string().nullable().optional(),
    shiftReason: z.string().min(3).max(500).optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.startDate !== undefined || value.workdays !== undefined) &&
      value.shiftReason === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["shiftReason"],
        message: "A schedule shift reason is required when dates change",
      })
    }
  })

const agentItemSchema = z.object({
  type: z.enum(["todo", "note", "checklist"]),
  title: z.string().min(1),
  content: z.string().optional(),
  conversationId: z.string().optional(),
  parentId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const agentItemUpdateSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  content: z.string().optional(),
  done: z.boolean().optional(),
  sortOrder: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const agentItemToggleSchema = z.object({
  id: z.string().min(1),
})

type MutationResult = {
  readonly success: boolean
  readonly id?: string
  readonly error?: string
}

/**
 * The server actions the agent's rendered UI may call. The app layer passes
 * the real actions in (src/app/api/agent/action/render-actions.ts), so each
 * call still runs that action's own auth and permission checks. Inputs are
 * validated against the schemas below before an action runs.
 */
export interface AgentRenderActions {
  createCustomer(data: unknown): Promise<MutationResult>
  updateCustomer(id: string, data: unknown): Promise<MutationResult>
  deleteCustomer(id: string): Promise<MutationResult>
  createVendor(data: {
    readonly name: string
    readonly category: string
    readonly email: string
    readonly phone: string
    readonly address: string
  }): Promise<MutationResult>
  updateVendor(id: string, data: {
    readonly name?: string
    readonly category?: string
    readonly email?: string
    readonly phone?: string
    readonly address?: string
  }): Promise<MutationResult>
  deleteVendor(id: string): Promise<MutationResult>
  createInvoice(data: unknown): Promise<MutationResult>
  updateInvoice(id: string, data: unknown): Promise<MutationResult>
  deleteInvoice(id: string): Promise<MutationResult>
  createVendorBill(data: unknown): Promise<MutationResult>
  updateVendorBill(id: string, data: unknown): Promise<MutationResult>
  deleteVendorBill(id: string): Promise<MutationResult>
  createTask(projectId: string, data: unknown): Promise<MutationResult>
  updateTask(id: string, data: unknown): Promise<MutationResult>
  deleteTask(id: string): Promise<MutationResult>
  createAgentItem(data: unknown): Promise<MutationResult>
  updateAgentItem(id: string, data: Record<string, unknown>, userId: string): Promise<MutationResult>
  deleteAgentItem(id: string, userId: string): Promise<MutationResult>
  toggleAgentItem(id: string, userId: string): Promise<MutationResult>
}

function wrapResult(result: MutationResult): ActionResult {
  if (result.success) {
    return {
      success: true,
      data: result.id ? { id: result.id } : undefined,
    }
  }
  return {
    success: false,
    error: result.error ?? "Unknown error",
  }
}

/** The record id every update, delete, and toggle schema requires. */
function recordId(params: Record<string, unknown>): string {
  return typeof params.id === "string" ? params.id : ""
}

/** The params without their record id, as the update actions expect. */
function withoutId(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([key]) => key !== "id"))
}

export type ActionRegistry = Readonly<Record<string, ActionDefinition>>

export function createActionRegistry(actions: AgentRenderActions): ActionRegistry {
  return {
    "customer.create": {
      schema: customerSchema,
      resource: "customer",
      permission: "create",
      execute: async (params) => wrapResult(await actions.createCustomer(params)),
    },
    "customer.update": {
      schema: customerUpdateSchema,
      resource: "customer",
      permission: "update",
      execute: async (params) =>
        wrapResult(await actions.updateCustomer(recordId(params), withoutId(params))),
    },
    "customer.delete": {
      schema: deleteSchema,
      resource: "customer",
      permission: "delete",
      execute: async (params) => wrapResult(await actions.deleteCustomer(recordId(params))),
    },

    "vendor.create": {
      schema: vendorSchema,
      resource: "vendor",
      permission: "create",
      execute: async (params) => {
        const result = await actions.createVendor({
          name: typeof params.name === "string" ? params.name : "",
          category:
            typeof params.category === "string"
              ? params.category
              : "Miscellaneous Vendor",
          email: typeof params.email === "string" ? params.email : "",
          phone: typeof params.phone === "string" ? params.phone : "",
          address: typeof params.address === "string" ? params.address : "",
        })
        return wrapResult(result)
      },
    },
    "vendor.update": {
      schema: vendorUpdateSchema,
      resource: "vendor",
      permission: "update",
      execute: async (params) => {
        const id = typeof params.id === "string" ? params.id : ""
        const result = await actions.updateVendor(id, {
          ...(typeof params.name === "string" ? { name: params.name } : {}),
          ...(typeof params.category === "string"
            ? { category: params.category }
            : {}),
          ...(typeof params.email === "string" ? { email: params.email } : {}),
          ...(typeof params.phone === "string" ? { phone: params.phone } : {}),
          ...(typeof params.address === "string"
            ? { address: params.address }
            : {}),
        })
        return wrapResult(result)
      },
    },
    "vendor.delete": {
      schema: deleteSchema,
      resource: "vendor",
      permission: "delete",
      execute: async (params) => wrapResult(await actions.deleteVendor(recordId(params))),
    },

    "invoice.create": {
      schema: invoiceSchema,
      resource: "finance",
      permission: "create",
      execute: async (params) => wrapResult(await actions.createInvoice(params)),
    },
    "invoice.update": {
      schema: invoiceUpdateSchema,
      resource: "finance",
      permission: "update",
      execute: async (params) =>
        wrapResult(await actions.updateInvoice(recordId(params), withoutId(params))),
    },
    "invoice.delete": {
      schema: deleteSchema,
      resource: "finance",
      permission: "delete",
      execute: async (params) => wrapResult(await actions.deleteInvoice(recordId(params))),
    },

    "vendorBill.create": {
      schema: vendorBillSchema,
      resource: "finance",
      permission: "create",
      execute: async (params) => wrapResult(await actions.createVendorBill(params)),
    },
    "vendorBill.update": {
      schema: vendorBillUpdateSchema,
      resource: "finance",
      permission: "update",
      execute: async (params) =>
        wrapResult(await actions.updateVendorBill(recordId(params), withoutId(params))),
    },
    "vendorBill.delete": {
      schema: deleteSchema,
      resource: "finance",
      permission: "delete",
      execute: async (params) => wrapResult(await actions.deleteVendorBill(recordId(params))),
    },

    "schedule.create": {
      schema: scheduleCreateSchema,
      resource: "schedule",
      permission: "create",
      execute: async (params) => {
        const projectId = typeof params.projectId === "string" ? params.projectId : ""
        const data = Object.fromEntries(
          Object.entries(params).filter(([key]) => key !== "projectId"),
        )
        return wrapResult(await actions.createTask(projectId, data))
      },
    },
    "schedule.update": {
      schema: scheduleUpdateSchema,
      resource: "schedule",
      permission: "update",
      execute: async (params) =>
        wrapResult(await actions.updateTask(recordId(params), withoutId(params))),
    },
    "schedule.delete": {
      schema: deleteSchema,
      resource: "schedule",
      permission: "delete",
      execute: async (params) => wrapResult(await actions.deleteTask(recordId(params))),
    },

    "agentItem.create": {
      schema: agentItemSchema,
      execute: async (params, userId) =>
        wrapResult(await actions.createAgentItem({ ...params, userId })),
    },
    "agentItem.update": {
      schema: agentItemUpdateSchema,
      execute: async (params, userId) =>
        wrapResult(await actions.updateAgentItem(recordId(params), withoutId(params), userId)),
    },
    "agentItem.delete": {
      schema: deleteSchema,
      execute: async (params, userId) =>
        wrapResult(await actions.deleteAgentItem(recordId(params), userId)),
    },
    "agentItem.toggle": {
      schema: agentItemToggleSchema,
      execute: async (params, userId) =>
        wrapResult(await actions.toggleAgentItem(recordId(params), userId)),
    },
  }
}

export function checkActionPermission(
  registry: ActionRegistry,
  user: AuthUser,
  actionName: string,
): boolean {
  const def = registry[actionName]
  if (!def) return false
  if (!def.resource || !def.permission) return true
  return can(user, def.resource, def.permission)
}
