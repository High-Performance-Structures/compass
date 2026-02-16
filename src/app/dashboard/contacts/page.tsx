"use client"

import * as React from "react"
import { IconPlus } from "@tabler/icons-react"
import { Plus } from "lucide-react"
import { useSearchParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { useRegisterPageActions } from "@/hooks/use-register-page-actions"

import {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "@/app/actions/customers"
import {
  getVendors,
  createVendor,
  updateVendor,
  deleteVendor,
} from "@/app/actions/vendors"
import type { Customer, Vendor } from "@/db/schema"
import { Button } from "@/components/ui/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { CustomersTable } from "@/components/financials/customers-table"
import { CustomerDialog } from "@/components/financials/customer-dialog"
import { VendorsTable } from "@/components/financials/vendors-table"
import { VendorDialog } from "@/components/financials/vendor-dialog"

type Tab = "customers" | "vendors"

export default function ContactsPage() {
  return (
    <React.Suspense fallback={<ContactsSkeleton />}>
      <ContactsContent />
    </React.Suspense>
  )
}

function ContactsSkeleton() {
  return (
    <div className="flex flex-1 flex-col min-h-0 p-4 sm:px-6 md:px-8 pt-3 gap-3">
      <div className="flex items-center justify-between shrink-0">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="h-9 w-full sm:w-80" />
      <Skeleton className="flex-1 rounded-md" />
    </div>
  )
}

function ContactsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialTab = (searchParams.get("tab") as Tab) || "customers"

  const [tab, setTab] = React.useState<Tab>(initialTab)
  const [loading, setLoading] = React.useState(true)

  const [customersList, setCustomersList] = React.useState<Customer[]>([])
  const [vendorsList, setVendorsList] = React.useState<Vendor[]>([])

  const [customerDialogOpen, setCustomerDialogOpen] = React.useState(false)
  const [editingCustomer, setEditingCustomer] =
    React.useState<Customer | null>(null)

  const [vendorDialogOpen, setVendorDialogOpen] = React.useState(false)
  const [editingVendor, setEditingVendor] =
    React.useState<Vendor | null>(null)

  const loadAll = async () => {
    try {
      const [customers, vendors] = await Promise.all([
        getCustomers(),
        getVendors(),
      ])
      setCustomersList(customers)
      setVendorsList(vendors)
    } catch {
      toast.error("Failed to load contacts")
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    loadAll()
  }, [])

  const openCustomer = React.useCallback(() => {
    setEditingCustomer(null)
    setCustomerDialogOpen(true)
  }, [])

  const openVendor = React.useCallback(() => {
    setEditingVendor(null)
    setVendorDialogOpen(true)
  }, [])

  const TAB_ACTIONS: Record<
    Tab,
    { id: string; label: string; onSelect: () => void }
  > = React.useMemo(
    () => ({
      customers: {
        id: "add-customer",
        label: "Add Customer",
        onSelect: openCustomer,
      },
      vendors: {
        id: "add-vendor",
        label: "Add Vendor",
        onSelect: openVendor,
      },
    }),
    [openCustomer, openVendor]
  )

  const pageActions = React.useMemo(() => {
    const action = TAB_ACTIONS[tab]
    return [{ ...action, icon: Plus }]
  }, [tab, TAB_ACTIONS])

  useRegisterPageActions(pageActions)

  const handleTabChange = (value: string) => {
    setTab(value as Tab)
    router.replace(`/dashboard/contacts?tab=${value}`, { scroll: false })
  }

  const handleCustomerSubmit = async (data: {
    name: string
    company: string
    email: string
    phone: string
    address: string
    notes: string
  }) => {
    if (editingCustomer) {
      const result = await updateCustomer(editingCustomer.id, data)
      if (result.success) {
        toast.success("Customer updated")
      } else {
        toast.error(result.error || "Failed")
        return
      }
    } else {
      const result = await createCustomer(data)
      if (result.success) {
        toast.success("Customer created")
      } else {
        toast.error(result.error || "Failed")
        return
      }
    }
    setCustomerDialogOpen(false)
    await loadAll()
  }

  const handleDeleteCustomer = async (id: string) => {
    const result = await deleteCustomer(id)
    if (result.success) {
      toast.success("Customer deleted")
      await loadAll()
    } else {
      toast.error(result.error || "Failed")
    }
  }

  const handleVendorSubmit = async (data: {
    name: string
    category: string
    email: string
    phone: string
    address: string
  }) => {
    if (editingVendor) {
      const result = await updateVendor(editingVendor.id, data)
      if (result.success) {
        toast.success("Vendor updated")
      } else {
        toast.error(result.error || "Failed")
        return
      }
    } else {
      const result = await createVendor(data)
      if (result.success) {
        toast.success("Vendor created")
      } else {
        toast.error(result.error || "Failed")
        return
      }
    }
    setVendorDialogOpen(false)
    await loadAll()
  }

  const handleDeleteVendor = async (id: string) => {
    const result = await deleteVendor(id)
    if (result.success) {
      toast.success("Vendor deleted")
      await loadAll()
    } else {
      toast.error(result.error || "Failed")
    }
  }

  if (loading) {
    return <ContactsSkeleton />
  }

  const addLabel = tab === "customers" ? "Add Customer" : "Add Vendor"
  const addHandler = tab === "customers" ? openCustomer : openVendor

  return (
    <>
      <div className="flex flex-1 flex-col min-h-0 p-4 sm:px-6 md:px-8 pt-3 gap-3">
        {/* single toolbar: tabs left, add button right */}
        <Tabs
          value={tab}
          onValueChange={handleTabChange}
          className="flex flex-1 flex-col min-h-0"
        >
          <div className="flex items-center justify-between gap-3 shrink-0">
            <TabsList>
              <TabsTrigger value="customers" className="text-xs sm:text-sm">
                Customers
                <span className="ml-1.5 text-muted-foreground tabular-nums">
                  {customersList.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="vendors" className="text-xs sm:text-sm">
                Vendors
                <span className="ml-1.5 text-muted-foreground tabular-nums">
                  {vendorsList.length}
                </span>
              </TabsTrigger>
            </TabsList>

            <Button onClick={addHandler} size="sm" className="h-8 shrink-0">
              <IconPlus className="size-3.5" />
              <span className="hidden sm:inline ml-1.5">{addLabel}</span>
            </Button>
          </div>

          <TabsContent
            value="customers"
            className="mt-3 flex-1 min-h-0 flex flex-col"
          >
            <CustomersTable
              customers={customersList}
              onEdit={(customer) => {
                setEditingCustomer(customer)
                setCustomerDialogOpen(true)
              }}
              onDelete={handleDeleteCustomer}
            />
          </TabsContent>

          <TabsContent
            value="vendors"
            className="mt-3 flex-1 min-h-0 flex flex-col"
          >
            <VendorsTable
              vendors={vendorsList}
              onEdit={(vendor) => {
                setEditingVendor(vendor)
                setVendorDialogOpen(true)
              }}
              onDelete={handleDeleteVendor}
            />
          </TabsContent>
        </Tabs>
      </div>

      <CustomerDialog
        open={customerDialogOpen}
        onOpenChange={setCustomerDialogOpen}
        initialData={editingCustomer}
        onSubmit={handleCustomerSubmit}
      />

      <VendorDialog
        open={vendorDialogOpen}
        onOpenChange={setVendorDialogOpen}
        initialData={editingVendor}
        onSubmit={handleVendorSubmit}
      />
    </>
  )
}
