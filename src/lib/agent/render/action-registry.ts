import { z } from "zod"
import type { AuthUser } from "@/lib/auth"
import {
  can,
  type Resource,
  type Action,
} from "@/lib/permissions"

import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "@/app/actions/customers"

import {
  createVendor,
  updateVendor,
  deleteVendor,
} from "@/app/actions/vendors"

import {
  createInvoice,
  updateInvoice,
  deleteInvoice,
} from "@/app/actions/invoices"

import {
  createVendorBill,
  updateVendorBill,
  deleteVendorBill,
} from "@/app/actions/vendor-bills"

import {
  createTask,
  updateTask,
  deleteTask,
} from "@/app/actions/schedule"

import {
  createAgentItem,
  updateAgentItem,
  deleteAgentItem,
  toggleAgentItem,
} from "@/app/actions/agent-items"

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

const scheduleUpdateSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  startDate: z.string().optional(),
  workdays: z.number().int().positive().optional(),
  phase: z.string().optional(),
  isMilestone: z.boolean().optional(),
  percentComplete: z.number().optional(),
  assignedTo: z.string().nullable().optional(),
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

function wrapResult(
  result: { success: boolean; id?: string; error?: string }
): ActionResult {
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

export const actionRegistry: Record<
  string,
  ActionDefinition
> = {
  "customer.create": {
    schema: customerSchema,
    resource: "customer",
    permission: "create",
    execute: async (params) => {
      const result = await createCustomer(
        params as Parameters<typeof createCustomer>[0]
      )
      return wrapResult(result)
    },
  },
  "customer.update": {
    schema: customerUpdateSchema,
    resource: "customer",
    permission: "update",
    execute: async (params) => {
      const { id, ...data } = params as { id: string } & Record<string, unknown>
      const result = await updateCustomer(id, data)
      return wrapResult(result)
    },
  },
  "customer.delete": {
    schema: deleteSchema,
    resource: "customer",
    permission: "delete",
    execute: async (params) => {
      const { id } = params as { id: string }
      const result = await deleteCustomer(id)
      return wrapResult(result)
    },
  },

  "vendor.create": {
    schema: vendorSchema,
    resource: "vendor",
    permission: "create",
    execute: async (params) => {
      const result = await createVendor(
        params as Parameters<typeof createVendor>[0]
      )
      return wrapResult(result)
    },
  },
  "vendor.update": {
    schema: vendorUpdateSchema,
    resource: "vendor",
    permission: "update",
    execute: async (params) => {
      const { id, ...data } = params as { id: string } & Record<string, unknown>
      const result = await updateVendor(id, data)
      return wrapResult(result)
    },
  },
  "vendor.delete": {
    schema: deleteSchema,
    resource: "vendor",
    permission: "delete",
    execute: async (params) => {
      const { id } = params as { id: string }
      const result = await deleteVendor(id)
      return wrapResult(result)
    },
  },

  "invoice.create": {
    schema: invoiceSchema,
    resource: "finance",
    permission: "create",
    execute: async (params) => {
      const result = await createInvoice(
        params as Parameters<typeof createInvoice>[0]
      )
      return wrapResult(result)
    },
  },
  "invoice.update": {
    schema: invoiceUpdateSchema,
    resource: "finance",
    permission: "update",
    execute: async (params) => {
      const { id, ...data } = params as { id: string } & Record<string, unknown>
      const result = await updateInvoice(id, data)
      return wrapResult(result)
    },
  },
  "invoice.delete": {
    schema: deleteSchema,
    resource: "finance",
    permission: "delete",
    execute: async (params) => {
      const { id } = params as { id: string }
      const result = await deleteInvoice(id)
      return wrapResult(result)
    },
  },

  "vendorBill.create": {
    schema: vendorBillSchema,
    resource: "finance",
    permission: "create",
    execute: async (params) => {
      const result = await createVendorBill(
        params as Parameters<typeof createVendorBill>[0]
      )
      return wrapResult(result)
    },
  },
  "vendorBill.update": {
    schema: vendorBillUpdateSchema,
    resource: "finance",
    permission: "update",
    execute: async (params) => {
      const { id, ...data } = params as { id: string } & Record<string, unknown>
      const result = await updateVendorBill(id, data)
      return wrapResult(result)
    },
  },
  "vendorBill.delete": {
    schema: deleteSchema,
    resource: "finance",
    permission: "delete",
    execute: async (params) => {
      const { id } = params as { id: string }
      const result = await deleteVendorBill(id)
      return wrapResult(result)
    },
  },

  "schedule.create": {
    schema: scheduleCreateSchema,
    resource: "schedule",
    permission: "create",
    execute: async (params) => {
      const { projectId, ...data } = params as {
        projectId: string
      } & Record<string, unknown>
      const result = await createTask(
        projectId,
        data as Parameters<typeof createTask>[1]
      )
      return wrapResult(result)
    },
  },
  "schedule.update": {
    schema: scheduleUpdateSchema,
    resource: "schedule",
    permission: "update",
    execute: async (params) => {
      const { id, ...data } = params as { id: string } & Record<string, unknown>
      const result = await updateTask(
        id,
        data as Parameters<typeof updateTask>[1]
      )
      return wrapResult(result)
    },
  },
  "schedule.delete": {
    schema: deleteSchema,
    resource: "schedule",
    permission: "delete",
    execute: async (params) => {
      const { id } = params as { id: string }
      const result = await deleteTask(id)
      return wrapResult(result)
    },
  },

  "agentItem.create": {
    schema: agentItemSchema,
    execute: async (params, userId) => {
      const result = await createAgentItem({
        ...(params as Parameters<typeof createAgentItem>[0]),
        userId,
      })
      return wrapResult(result)
    },
  },
  "agentItem.update": {
    schema: agentItemUpdateSchema,
    execute: async (params, userId) => {
      const { id, ...data } = params as { id: string } & Record<string, unknown>
      const result = await updateAgentItem(id, data, userId)
      return wrapResult(result)
    },
  },
  "agentItem.delete": {
    schema: deleteSchema,
    execute: async (params, userId) => {
      const { id } = params as { id: string }
      const result = await deleteAgentItem(id, userId)
      return wrapResult(result)
    },
  },
  "agentItem.toggle": {
    schema: agentItemToggleSchema,
    execute: async (params, userId) => {
      const { id } = params as { id: string }
      const result = await toggleAgentItem(id, userId)
      return wrapResult(result)
    },
  },
}

export function checkActionPermission(
  user: AuthUser,
  actionName: string,
): boolean {
  const def = actionRegistry[actionName]
  if (!def) return false
  if (!def.resource || !def.permission) return true
  return can(user, def.resource, def.permission)
}
