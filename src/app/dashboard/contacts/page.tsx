"use client"

import * as React from "react"
import { IconPlus, IconShieldCheck } from "@tabler/icons-react"
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
  getInternalDirectoryContacts,
  createVendor,
  updateVendor,
  deleteVendor,
  type InternalDirectoryContact,
} from "@/app/actions/vendors"
import type { Customer, Vendor } from "@/db/schema"
import { Badge } from "@/components/ui/badge"
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

type Tab = "customers" | "vendors" | "internal"

const DEFAULT_VENDOR_CATEGORIES = [
  "Supplier",
  "Subcontractor",
  "Consultant",
  "Governmental Agency",
  "Miscellaneous Vendor",
  "Building Department",
  "Bank / Lender",
] as const

function toContactsTab(value: string | null): Tab {
  if (value === "vendors") return "vendors"
  if (value === "internal") return "internal"
  return "customers"
}

function isInternalVendor(vendor: Vendor): boolean {
  return vendor.category.trim().toLowerCase() === "internal"
}

function InternalContactsTable({
  contacts,
}: {
  readonly contacts: readonly InternalDirectoryContact[]
}): React.ReactElement {
  if (contacts.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-muted-foreground">No internal contacts yet</p>
        <p className="mt-1 text-sm text-muted-foreground/70">
          Import or assign employees to projects.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
          <tr className="border-b">
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="px-3 py-2 text-left font-medium">Company</th>
            <th className="px-3 py-2 text-left font-medium">Role</th>
            <th className="px-3 py-2 text-left font-medium">Contact</th>
            <th className="px-3 py-2 text-left font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact) => (
            <tr key={contact.id} className="border-b last:border-b-0">
              <td className="px-3 py-2 font-medium">{contact.name}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {contact.company ?? "Internal"}
              </td>
              <td className="px-3 py-2">
                <Badge variant="secondary">{contact.role ?? "Internal"}</Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                <div className="flex flex-col gap-0.5">
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className="hover:underline">
                      {contact.email}
                    </a>
                  ) : (
                    <span>No email</span>
                  )}
                  {contact.phone ? (
                    <a href={`tel:${contact.phone}`} className="hover:underline">
                      {contact.phone}
                    </a>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-2">
                <Badge variant="outline">{contact.sourceLabel}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

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
  const initialTab = toContactsTab(searchParams.get("tab"))
  const contactId = searchParams.get("contactId")

  const [tab, setTab] = React.useState<Tab>(initialTab)
  const [loading, setLoading] = React.useState(true)
  const [openedContactId, setOpenedContactId] = React.useState<string | null>(
    null
  )

  const [customersList, setCustomersList] = React.useState<Customer[]>([])
  const [vendorsList, setVendorsList] = React.useState<Vendor[]>([])
  const [internalContactsList, setInternalContactsList] = React.useState<
    readonly InternalDirectoryContact[]
  >([])

  const [customerDialogOpen, setCustomerDialogOpen] = React.useState(false)
  const [editingCustomer, setEditingCustomer] =
    React.useState<Customer | null>(null)

  const [vendorDialogOpen, setVendorDialogOpen] = React.useState(false)
  const [editingVendor, setEditingVendor] =
    React.useState<Vendor | null>(null)

  const loadAll = async () => {
    try {
      const [customers, vendors, internalContacts] = await Promise.all([
        getCustomers(),
        getVendors(),
        getInternalDirectoryContacts(),
      ])
      setCustomersList(customers)
      setVendorsList(vendors)
      setInternalContactsList(internalContacts)
    } catch {
      toast.error("Failed to load contacts")
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    loadAll()
  }, [])

  React.useEffect(() => {
    const nextTab = toContactsTab(searchParams.get("tab"))
    setTab(nextTab)
  }, [searchParams])

  React.useEffect(() => {
    if (loading || !contactId || openedContactId === contactId) return

    if (tab === "customers") {
      const customer = customersList.find((item) => item.id === contactId)
      if (!customer) return

      setEditingCustomer(customer)
      setCustomerDialogOpen(true)
      setOpenedContactId(contactId)
      return
    }

    if (tab === "vendors") {
      const vendor = vendorsList.find((item) => item.id === contactId)
      if (!vendor) return

      setEditingVendor(vendor)
      setVendorDialogOpen(true)
      setOpenedContactId(contactId)
    }
  }, [
    contactId,
    customersList,
    loading,
    openedContactId,
    tab,
    vendorsList,
  ])

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
      internal: {
        id: "internal-directory",
        label: "Internal Directory",
        onSelect: () => undefined,
      },
    }),
    [openCustomer, openVendor]
  )

  const pageActions = React.useMemo(() => {
    if (tab === "internal") return []

    const action = TAB_ACTIONS[tab]
    return [{ ...action, icon: Plus }]
  }, [tab, TAB_ACTIONS])

  useRegisterPageActions(pageActions)

  const handleTabChange = (value: string) => {
    const nextTab = toContactsTab(value)
    setTab(nextTab)
    setOpenedContactId(null)
    router.replace(`/dashboard/contacts?tab=${nextTab}`, { scroll: false })
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

  const vendorContacts = vendorsList.filter((vendor) => !isInternalVendor(vendor))
  const addLabel = tab === "customers" ? "Add Customer" : "Add Vendor"
  const addHandler = tab === "customers" ? openCustomer : openVendor
  const vendorCategories = Array.from(
    new Set([
      ...DEFAULT_VENDOR_CATEGORIES,
      ...vendorContacts
        .map((vendor) => vendor.category?.trim())
        .filter((category): category is string => {
          return Boolean(category) && category.toLowerCase() !== "internal"
        }),
    ])
  ).sort((left, right) => left.localeCompare(right))

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
                  {vendorContacts.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="internal" className="text-xs sm:text-sm">
                Internal
                <span className="ml-1.5 text-muted-foreground tabular-nums">
                  {internalContactsList.length}
                </span>
              </TabsTrigger>
            </TabsList>

            {tab !== "internal" ? (
              <Button onClick={addHandler} size="sm" className="h-8 shrink-0">
                <IconPlus className="size-3.5" />
                <span className="hidden sm:inline ml-1.5">{addLabel}</span>
              </Button>
            ) : (
              <Badge variant="outline" className="h-8 gap-1.5 px-3">
                <IconShieldCheck className="size-3.5" />
                HPS / Nu-Tech / ORC
              </Badge>
            )}
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
              vendors={vendorContacts}
              categories={vendorCategories}
              onEdit={(vendor) => {
                setEditingVendor(vendor)
                setVendorDialogOpen(true)
              }}
              onDelete={handleDeleteVendor}
            />
          </TabsContent>

          <TabsContent
            value="internal"
            className="mt-3 flex-1 min-h-0 flex flex-col"
          >
            <InternalContactsTable contacts={internalContactsList} />
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
        categories={vendorCategories}
        onSubmit={handleVendorSubmit}
      />
    </>
  )
}
