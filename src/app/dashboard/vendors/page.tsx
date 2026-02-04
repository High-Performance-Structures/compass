"use client"

import * as React from "react"
import { IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  getVendors,
  createVendor,
  updateVendor,
  deleteVendor,
} from "@/app/actions/vendors"
import type { Vendor } from "@/db/schema"
import { Button } from "@/components/ui/button"
import { VendorsTable } from "@/components/financials/vendors-table"
import { VendorDialog } from "@/components/financials/vendor-dialog"

export default function VendorsPage() {
  const [vendors, setVendors] = React.useState<Vendor[]>([])
  const [loading, setLoading] = React.useState(true)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Vendor | null>(null)

  const load = async () => {
    try {
      const data = await getVendors()
      setVendors(data)
    } catch {
      toast.error("Failed to load vendors")
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => { load() }, [])

  const handleCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const handleEdit = (vendor: Vendor) => {
    setEditing(vendor)
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    const result = await deleteVendor(id)
    if (result.success) {
      toast.success("Vendor deleted")
      await load()
    } else {
      toast.error(result.error || "Failed to delete vendor")
    }
  }

  const handleSubmit = async (data: {
    name: string
    category: string
    email: string
    phone: string
    address: string
  }) => {
    if (editing) {
      const result = await updateVendor(editing.id, data)
      if (result.success) {
        toast.success("Vendor updated")
      } else {
        toast.error(result.error || "Failed to update vendor")
        return
      }
    } else {
      const result = await createVendor(data)
      if (result.success) {
        toast.success("Vendor created")
      } else {
        toast.error(result.error || "Failed to create vendor")
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
              Vendors
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground">
              Manage vendor relationships
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
              Vendors
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground">
              Manage vendor relationships
            </p>
          </div>
          <Button onClick={handleCreate} className="w-full sm:w-auto">
            <IconPlus className="mr-2 size-4" />
            Add Vendor
          </Button>
        </div>

        {vendors.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center">
            <p className="text-muted-foreground">No vendors yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Add your first vendor to manage subcontractors, suppliers, and bills.
            </p>
          </div>
        ) : (
          <VendorsTable
            vendors={vendors}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </div>

      <VendorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialData={editing}
        onSubmit={handleSubmit}
      />
    </>
  )
}
