import { describe, expect, it, vi } from "vitest"

import type { AuthUser } from "@/lib/auth"
import {
  checkActionPermission,
  createActionRegistry,
  type AgentRenderActions,
} from "@/lib/agent/render/action-registry"

const ok = { success: true }

function fakeActions(): AgentRenderActions {
  return {
    createCustomer: vi.fn(async () => ({ success: true, id: "c-1" })),
    updateCustomer: vi.fn(async () => ok),
    deleteCustomer: vi.fn(async () => ok),
    createVendor: vi.fn(async () => ok),
    updateVendor: vi.fn(async () => ok),
    deleteVendor: vi.fn(async () => ok),
    createInvoice: vi.fn(async () => ok),
    updateInvoice: vi.fn(async () => ok),
    deleteInvoice: vi.fn(async () => ({ success: false, error: "Permission denied: finance delete" })),
    createVendorBill: vi.fn(async () => ok),
    updateVendorBill: vi.fn(async () => ok),
    deleteVendorBill: vi.fn(async () => ok),
    createTask: vi.fn(async () => ({ success: true, id: "t-1" })),
    updateTask: vi.fn(async () => ok),
    deleteTask: vi.fn(async () => ok),
    createAgentItem: vi.fn(async () => ({ success: true, id: "i-1" })),
    updateAgentItem: vi.fn(async () => ok),
    deleteAgentItem: vi.fn(async () => ok),
    toggleAgentItem: vi.fn(async () => ok),
  }
}

const viewer: AuthUser = {
  id: "user-1",
  email: "viewer@example.com",
  firstName: null,
  lastName: null,
  displayName: "Viewer",
  avatarUrl: null,
  role: "guest",
  googleEmail: null,
  isActive: true,
  lastLoginAt: null,
  organizationId: "org-1",
  organizationName: "Example",
  organizationType: "external",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

describe("agent render action registry", () => {
  it("passes the record id and the remaining fields to update actions", async () => {
    const actions = fakeActions()
    const registry = createActionRegistry(actions)

    const result = await registry["customer.update"]?.execute({ id: "c-1", name: "Acme", notes: "x" }, "user-1")

    expect(actions.updateCustomer).toHaveBeenCalledWith("c-1", { name: "Acme", notes: "x" })
    expect(result).toEqual({ success: true, data: undefined })
  })

  it("splits the project id off schedule creates and wraps the new id", async () => {
    const actions = fakeActions()
    const registry = createActionRegistry(actions)

    const result = await registry["schedule.create"]?.execute(
      { projectId: "p-1", title: "Frame", startDate: "2026-11-02", workdays: 3, phase: "framing" },
      "user-1",
    )

    expect(actions.createTask).toHaveBeenCalledWith("p-1", {
      title: "Frame",
      startDate: "2026-11-02",
      workdays: 3,
      phase: "framing",
    })
    expect(result).toEqual({ success: true, data: { id: "t-1" } })
  })

  it("defaults a new vendor's category and runs agent items as the user", async () => {
    const actions = fakeActions()
    const registry = createActionRegistry(actions)

    await registry["vendor.create"]?.execute({ name: "Supply Co" }, "user-1")
    await registry["agentItem.create"]?.execute({ type: "todo", title: "Call" }, "user-9")
    await registry["agentItem.toggle"]?.execute({ id: "i-1" }, "user-9")

    expect(actions.createVendor).toHaveBeenCalledWith({
      name: "Supply Co",
      category: "Miscellaneous Vendor",
      email: "",
      phone: "",
      address: "",
    })
    expect(actions.createAgentItem).toHaveBeenCalledWith({ type: "todo", title: "Call", userId: "user-9" })
    expect(actions.toggleAgentItem).toHaveBeenCalledWith("i-1", "user-9")
  })

  it("returns the action's own error message unchanged", async () => {
    const registry = createActionRegistry(fakeActions())

    expect(await registry["invoice.delete"]?.execute({ id: "inv-1" }, "user-1")).toEqual({
      success: false,
      error: "Permission denied: finance delete",
    })
  })

  it("checks the resource permission, allows agent items, and refuses unknown actions", () => {
    const registry = createActionRegistry(fakeActions())

    expect(checkActionPermission(registry, viewer, "customer.delete")).toBe(false)
    expect(checkActionPermission(registry, viewer, "agentItem.create")).toBe(true)
    expect(checkActionPermission(registry, viewer, "nope")).toBe(false)
  })
})
