import {
  createActionRegistry,
  type ActionRegistry,
} from "@/lib/agent/render/action-registry"
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

/**
 * The actions the agent's rendered UI can run. Each is the real server
 * action, so its own auth and permission checks still apply.
 */
export const actionRegistry: ActionRegistry = createActionRegistry({
  createCustomer,
  updateCustomer,
  deleteCustomer,
  createVendor,
  updateVendor,
  deleteVendor,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  createVendorBill,
  updateVendorBill,
  deleteVendorBill,
  createTask,
  updateTask,
  deleteTask,
  createAgentItem,
  updateAgentItem,
  deleteAgentItem,
  toggleAgentItem,
})
