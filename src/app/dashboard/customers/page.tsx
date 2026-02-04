"use client"

import * as React from "react"
import { IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "@/app/actions/customers"
import type { Customer } from "@/db/schema"
import { Button } from "@/components/ui/button"
import { CustomersTable } from "@/components/financials/customers-table"
import { CustomerDialog } from "@/components/financials/customer-dialog"

export default function CustomersPage() {
  const [customers, setCustomers] = React.useState<Customer[]>([])
  const [loading, setLoading] = React.useState(true)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Customer | null>(null)

  const load = async () => {
    try {
      const data = await getCustomers()
      setCustomers(data)
    } catch {
      toast.error("Failed to load customers")
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => { load() }, [])

  const handleCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const handleEdit = (customer: Customer) => {
    setEditing(customer)
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    const result = await deleteCustomer(id)
    if (result.success) {
      toast.success("Customer deleted")
      await load()
    } else {
      toast.error(result.error || "Failed to delete customer")
    }
  }

  const handleSubmit = async (data: {
    name: string
    company: string
    email: string
    phone: string
    address: string
    notes: string
  }) => {
    if (editing) {
      const result = await updateCustomer(editing.id, data)
      if (result.success) {
        toast.success("Customer updated")
      } else {
        toast.error(result.error || "Failed to update customer")
        return
      }
    } else {
      const result = await createCustomer(data)
      if (result.success) {
        toast.success("Customer created")
      } else {
        toast.error(result.error || "Failed to create customer")
        return
      }
    }
    setDialogOpen(false)
    await load()
  }

  if (loading) {
    return (
      <div className="flex-1 space-y-4 p-4 sm:p-6 md:p-8 pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Customers
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground">
              Manage customer accounts
            </p>
          </div>
        </div>
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          Loading...
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex-1 space-y-4 p-4 sm:p-6 md:p-8 pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Customers
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground">
              Manage customer accounts
            </p>
          </div>
          <Button onClick={handleCreate} className="w-full sm:w-auto">
            <IconPlus className="mr-2 size-4" />
            Add Customer
          </Button>
        </div>

        {customers.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center">
            <p className="text-muted-foreground">No customers yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Add your first customer to start tracking contacts and invoices.
            </p>
          </div>
        ) : (
          <CustomersTable
            customers={customers}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </div>

      <CustomerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialData={editing}
        onSubmit={handleSubmit}
      />
    </>
  )
}
