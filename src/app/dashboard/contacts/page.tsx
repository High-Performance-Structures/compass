"use client"

import * as React from "react"
import { IconPlus, IconShieldCheck } from "@tabler/icons-react"
import { Plus } from "lucide-react"
import { useSearchParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { useRegisterPageActions } from "@/hooks/use-register-page-actions"

import {
  getContactDirectoryAccess,
  type ContactDirectoryAccess,
} from "@/app/actions/contact-directory-access"
import {
  getCustomers,
  createCustomerDirectoryContact,
  updateCustomer,
  deleteCustomer,
  type CustomerRelationshipType,
} from "@/app/actions/customers"
import {
  getVendors,
  getInternalDirectoryContacts,
  createVendor,
  updateVendor,
  deleteVendor,
  type InternalDirectoryContact,
  type VendorCompanyMutationInput,
  type VendorDirectoryCompany,
} from "@/app/actions/vendors"
import type { Customer } from "@/db/schema"
import type { CustomerDirectoryPerson } from "@/app/actions/customer-people"
import { getMyContactRecords, type MyContactRecord } from "@/app/actions/my-contact-records"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TeamTab } from "@/components/settings/team-tab"
import { CustomersTable } from "@/components/financials/customers-table"
import { CustomerDialog } from "@/components/financials/customer-dialog"
import { VendorsTable } from "@/components/financials/vendors-table"
import { VendorDialog } from "@/components/financials/vendor-dialog"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { CustomerPeopleDialog } from "@/components/contacts/customer-people-dialog"
import { DirectoryAccountLinkDialog, type DirectoryAccountLinkTarget } from "@/components/contacts/directory-account-link-dialog"
import { SageContactEditorDialog, type SageContactEditorTarget } from "@/components/contacts/sage-contact-editor-dialog"
import { SageContactReviewDialog } from "@/components/contacts/sage-contact-review-dialog"
import { listMySageContactProposalStatuses, type MySageContactProposalStatus } from "@/app/actions/sage-contact-changes"

type Tab = "customers" | "vendors" | "internal"
type DirectoryCapabilities = Record<Tab, ContactDirectoryAccess> & {
  readonly canManageAccounts: boolean
  readonly canReadSageReview: boolean
  readonly canApproveSageReview: boolean
}

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

function isInternalVendor(vendor: VendorDirectoryCompany): boolean {
  return vendor.category.trim().toLowerCase() === "internal"
}

function InternalContactsTable({
  contacts,
  onSageEdit,
}: {
  readonly contacts: readonly InternalDirectoryContact[]
  readonly onSageEdit?: (contact: InternalDirectoryContact) => void
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()

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
            <th className="px-3 py-2 text-left font-medium">Compass access</th>
            {developerModeEnabled && (
              <th className="px-3 py-2 text-left font-medium">Source</th>
            )}
            {onSageEdit ? <th className="px-3 py-2 text-left font-medium">Actions</th> : null}
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
                <Badge variant="outline">
                  {contact.accessStatus === "active"
                    ? "Active"
                    : contact.accessStatus === "invited"
                      ? "Invitation pending"
                      : "No account"}
                </Badge>
              </td>
              {developerModeEnabled && (
                <td className="px-3 py-2">
                  <Badge variant="outline">{contact.sourceLabel}</Badge>
                </td>
              )}
              {onSageEdit ? (
                <td className="px-3 py-2">
                  {contact.sageEmployeeId ? <Button type="button" size="sm" variant="outline" onClick={() => onSageEdit(contact)}>Propose Sage edit</Button> : null}
                </td>
              ) : null}
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

  const [tab, setTab] = React.useState<Tab>(initialTab)
  const [accessDialogOpen, setAccessDialogOpen] = React.useState(false)
  const [sageReviewOpen, setSageReviewOpen] = React.useState(false)
  const [myContactsOpen, setMyContactsOpen] = React.useState(false)
  const [myContacts, setMyContacts] = React.useState<readonly MyContactRecord[]>([])
  const [myProposalStatuses, setMyProposalStatuses] = React.useState<readonly MySageContactProposalStatus[]>([])
  const [sageEditorTarget, setSageEditorTarget] = React.useState<SageContactEditorTarget | null>(null)
  const [accountLinkTarget, setAccountLinkTarget] = React.useState<DirectoryAccountLinkTarget | null>(null)
  const [peopleCustomer, setPeopleCustomer] = React.useState<Customer | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [directoryAccess, setDirectoryAccess] = React.useState<DirectoryCapabilities | null>(null)

  const [customersList, setCustomersList] = React.useState<Customer[]>([])
  const [vendorsList, setVendorsList] = React.useState<
    readonly VendorDirectoryCompany[]
  >([])
  const [internalContactsList, setInternalContactsList] = React.useState<
    readonly InternalDirectoryContact[]
  >([])

  const [customerDialogOpen, setCustomerDialogOpen] = React.useState(false)
  const [editingCustomer, setEditingCustomer] =
    React.useState<Customer | null>(null)

  const [vendorDialogOpen, setVendorDialogOpen] = React.useState(false)
  const [vendorReadOnly, setVendorReadOnly] = React.useState(false)
  const [editingVendor, setEditingVendor] =
    React.useState<VendorDirectoryCompany | null>(null)

  const loadAll = React.useCallback(async () => {
    try {
      const access = await getContactDirectoryAccess()
      const [customers, vendors, internalContacts, myRecords, myStatuses] = await Promise.all([
        access.customers.read ? getCustomers() : Promise.resolve([]),
        access.vendors.read ? getVendors() : Promise.resolve([]),
        access.internal.read ? getInternalDirectoryContacts() : Promise.resolve([]),
        getMyContactRecords(),
        listMySageContactProposalStatuses(),
      ])
      setDirectoryAccess(access)
      if (!access[tab].read) {
        const firstVisible = (["customers", "vendors", "internal"] as const).find((candidate) => access[candidate].read)
        if (firstVisible) setTab(firstVisible)
      }
      setCustomersList(customers)
      setVendorsList(vendors)
      setInternalContactsList(internalContacts)
      setMyContacts(myRecords)
      setMyProposalStatuses(myStatuses)
    } catch {
      toast.error("Failed to load contacts")
    } finally {
      setLoading(false)
    }
  }, [tab])

  React.useEffect(() => {
    void loadAll()
  }, [loadAll])

  const openCustomer = React.useCallback(() => {
    setEditingCustomer(null)
    setCustomerDialogOpen(true)
  }, [])

  const openVendor = React.useCallback(() => {
    setEditingVendor(null)
    setVendorReadOnly(false)
    setVendorDialogOpen(true)
  }, [])

  const TAB_ACTIONS: Record<
    Tab,
    { id: string; label: string; onSelect: () => void }
  > = React.useMemo(
    () => ({
      customers: {
        id: "add-customer",
        label: "Add Client / Lead",
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
    if (tab === "internal" || !directoryAccess?.[tab].create) return []

    const action = TAB_ACTIONS[tab]
    return [{ ...action, icon: Plus }]
  }, [tab, TAB_ACTIONS, directoryAccess])

  useRegisterPageActions(pageActions)

  const handleTabChange = (value: string) => {
    const nextTab = toContactsTab(value)
    setTab(nextTab)
    router.replace(`/dashboard/contacts?tab=${nextTab}`, { scroll: false })
  }

  const handleCustomerSubmit = async (data: {
    name: string
    company: string
    email: string
    phone: string
    address: string
    notes: string
    relationshipType: CustomerRelationshipType
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
      const result = await createCustomerDirectoryContact({
        ...data,
        company: data.company || null,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        notes: data.notes || null,
      })
      if (result.success) {
        toast.success(
          result.existing
            ? "Existing client/lead contact selected"
            : "Client/lead contact added to Contacts"
        )
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

  const handleVendorSubmit = async (data: VendorCompanyMutationInput) => {
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

  const accessManagerDialog = directoryAccess?.canManageAccounts ? (
    <Dialog open={accessDialogOpen} onOpenChange={setAccessDialogOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Compass access</DialogTitle>
          <DialogDescription>
            Manage invitations, account roles, and project access. Contact records remain in the directories behind this dialog.
          </DialogDescription>
        </DialogHeader>
        <TeamTab initialSection={tab === "customers" ? "clients" : tab} />
      </DialogContent>
    </Dialog>
  ) : null

  const myContactsDialog = (
    <Dialog open={myContactsOpen} onOpenChange={setMyContactsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>My contact information</DialogTitle>
          <DialogDescription>Propose a change to your own verified Sage contact record. Another authorized staff member reviews it before Sage is updated.</DialogDescription>
        </DialogHeader>
        {myContacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No directory person is linked to your Compass account yet. Ask an account administrator to verify and link the correct contact record.</p>
        ) : (
          <div className="space-y-2">
            {myContacts.map((record) => (
              <div key={`${record.kind}:${record.entityId}`} className="flex items-center justify-between gap-3 border-b py-2 text-sm">
                <div><div className="font-medium">{record.name}</div><div className="text-muted-foreground">{record.companyName ?? "Internal"}</div></div>
                {record.sageLinked ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    setMyContactsOpen(false)
                    setSageEditorTarget({ kind: record.kind, entityId: record.entityId, name: record.name })
                  }}>Propose edit</Button>
                ) : <Badge variant="outline">Sage link pending</Badge>}
              </div>
            ))}
          </div>
        )}
        {myProposalStatuses.length > 0 ? (
          <div className="space-y-2 border-t pt-3 text-sm">
            <p className="font-medium">Recent proposals</p>
            {myProposalStatuses.map((proposal) => (
              <div key={proposal.id} className="flex flex-wrap justify-between gap-2 border-b pb-2">
                <span>{proposal.kind.replaceAll("_", " ")} · {new Date(proposal.requestedAt).toLocaleDateString()}</span>
                <span>{proposal.status}{proposal.errorMessage ? ` · ${proposal.errorMessage}` : ""}</span>
              </div>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )

  if (directoryAccess && !directoryAccess.customers.read && !directoryAccess.vendors.read && !directoryAccess.internal.read) {
    return (
      <>
        <div className="space-y-3 p-6 text-sm text-muted-foreground">
          <p>You do not have access to a shared contacts directory. You can still manage your own linked contact record.</p>
          <Button variant="outline" size="sm" onClick={() => setMyContactsOpen(true)}>My contact information</Button>
          {directoryAccess.canManageAccounts && (
            <Button variant="outline" size="sm" onClick={() => setAccessDialogOpen(true)}>
              Manage Compass access
            </Button>
          )}
        </div>
        {accessManagerDialog}
        {myContactsDialog}
        <SageContactEditorDialog
          key={sageEditorTarget ? `${sageEditorTarget.kind}:${sageEditorTarget.entityId}` : "none"}
          target={sageEditorTarget}
          onOpenChange={(open) => { if (!open) setSageEditorTarget(null) }}
          onSubmitted={() => { void loadAll() }}
        />
      </>
    )
  }

  const vendorContacts = vendorsList.filter((vendor) => !isInternalVendor(vendor))
  const addLabel = tab === "customers" ? "Add Client / Lead" : "Add Vendor"
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
              <TabsTrigger value="customers" disabled={!directoryAccess?.customers.read} className="text-xs sm:text-sm">
                Clients & Leads
                <span className="ml-1.5 text-muted-foreground tabular-nums">
                  {customersList.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="vendors" disabled={!directoryAccess?.vendors.read} className="text-xs sm:text-sm">
                Vendors
                <span className="ml-1.5 text-muted-foreground tabular-nums">
                  {vendorContacts.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="internal" disabled={!directoryAccess?.internal.read} className="text-xs sm:text-sm">
                Internal
                <span className="ml-1.5 text-muted-foreground tabular-nums">
                  {internalContactsList.length}
                </span>
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" onClick={() => setMyContactsOpen(true)}>My contact information</Button>
              {directoryAccess?.canReadSageReview ? (
                <Button variant="outline" size="sm" className="h-8" onClick={() => setSageReviewOpen(true)}>Sage review</Button>
              ) : null}
              {directoryAccess?.canManageAccounts && (
                <Button variant="outline" size="sm" className="h-8" onClick={() => setAccessDialogOpen(true)}>
                  Manage Compass access
                </Button>
              )}
              {tab !== "internal" && directoryAccess?.[tab].create ? (
                <Button onClick={addHandler} size="sm" className="h-8 shrink-0">
                  <IconPlus className="size-3.5" />
                  <span className="hidden sm:inline ml-1.5">{addLabel}</span>
                </Button>
              ) : tab === "internal" ? (
                <Badge variant="outline" className="hidden h-8 gap-1.5 px-3 sm:inline-flex">
                  <IconShieldCheck className="size-3.5" />
                  HPS / Nu-Tech / ORC
                </Badge>
              ) : null}
            </div>
          </div>

          <TabsContent
            value="customers"
            className="mt-3 flex-1 min-h-0 flex flex-col"
          >
            <CustomersTable
              customers={customersList}
              onViewPeople={(customer) => setPeopleCustomer(customer)}
              onEdit={directoryAccess?.customers.edit ? (customer) => {
                setEditingCustomer(customer)
                setCustomerDialogOpen(true)
              } : undefined}
              onDelete={directoryAccess?.customers.delete ? handleDeleteCustomer : undefined}
            />
          </TabsContent>

          <TabsContent
            value="vendors"
            className="mt-3 flex-1 min-h-0 flex flex-col"
          >
            <VendorsTable
              vendors={vendorContacts}
              categories={vendorCategories}
              onView={(vendor) => {
                setEditingVendor(vendor)
                setVendorReadOnly(true)
                setVendorDialogOpen(true)
              }}
              onEdit={directoryAccess?.vendors.edit ? (vendor) => {
                setEditingVendor(vendor)
                setVendorReadOnly(false)
                setVendorDialogOpen(true)
              } : undefined}
              onDelete={directoryAccess?.vendors.delete ? handleDeleteVendor : undefined}
            />
          </TabsContent>

          <TabsContent
            value="internal"
            className="mt-3 flex-1 min-h-0 flex flex-col"
          >
            <InternalContactsTable
              contacts={internalContactsList}
              onSageEdit={directoryAccess?.internal.edit ? (contact) => setSageEditorTarget({ kind: "employee", entityId: contact.id, name: contact.name }) : undefined}
            />
          </TabsContent>
        </Tabs>
      </div>

      {accessManagerDialog}
      {myContactsDialog}

      <CustomerDialog
        open={customerDialogOpen}
        onOpenChange={setCustomerDialogOpen}
        initialData={editingCustomer}
        onSubmit={handleCustomerSubmit}
        onManagePeople={editingCustomer ? () => {
          setCustomerDialogOpen(false)
          setPeopleCustomer(editingCustomer)
        } : undefined}
        onSageEditCompany={editingCustomer ? () => {
          setCustomerDialogOpen(false)
          setSageEditorTarget({ kind: "client_company", entityId: editingCustomer.id, name: editingCustomer.name })
        } : undefined}
      />

      <VendorDialog
        open={vendorDialogOpen}
        onOpenChange={setVendorDialogOpen}
        initialData={editingVendor}
        readOnly={vendorReadOnly}
        categories={vendorCategories}
        onSubmit={handleVendorSubmit}
        onSageEditCompany={editingVendor ? () => {
          setVendorDialogOpen(false)
          setSageEditorTarget({ kind: "vendor_company", entityId: editingVendor.id, name: editingVendor.name })
        } : undefined}
        onSageEditContact={directoryAccess?.vendors.edit ? (contactId, name) => {
          setVendorDialogOpen(false)
          setSageEditorTarget({ kind: "vendor_person", entityId: contactId, name })
        } : undefined}
        onLinkAccount={directoryAccess?.canManageAccounts ? (contactId, name, userId) => {
          setVendorDialogOpen(false)
          setAccountLinkTarget({ kind: "vendor_person", personId: contactId, name, userId })
        } : undefined}
      />
      <CustomerPeopleDialog
        key={peopleCustomer?.id ?? "none"}
        customer={peopleCustomer ? { id: peopleCustomer.id, name: peopleCustomer.name, sageLinked: Boolean(peopleCustomer.sageClientId || peopleCustomer.sageClientNumber) } : null}
        onOpenChange={(open) => { if (!open) setPeopleCustomer(null) }}
        canEdit={directoryAccess?.customers.edit ?? false}
        canDelete={directoryAccess?.customers.delete ?? false}
        canLinkAccounts={directoryAccess?.canManageAccounts ?? false}
        onSageEdit={(person: CustomerDirectoryPerson) => {
          setPeopleCustomer(null)
          setSageEditorTarget({ kind: "client_person", entityId: person.id, name: person.name })
        }}
        onLinkAccount={(person: CustomerDirectoryPerson) => {
          setPeopleCustomer(null)
          setAccountLinkTarget({ kind: "client_person", personId: person.id, name: person.name, userId: person.userId })
        }}
      />
      <SageContactEditorDialog
        key={sageEditorTarget ? `${sageEditorTarget.kind}:${sageEditorTarget.entityId}` : "none"}
        target={sageEditorTarget}
        onOpenChange={(open) => { if (!open) setSageEditorTarget(null) }}
        onSubmitted={() => { void loadAll() }}
      />
      <DirectoryAccountLinkDialog
        key={accountLinkTarget ? `${accountLinkTarget.kind}:${accountLinkTarget.personId}` : "none"}
        target={accountLinkTarget}
        onOpenChange={(open) => { if (!open) setAccountLinkTarget(null) }}
        onLinked={() => { void loadAll() }}
      />
      {directoryAccess?.canReadSageReview ? (
        <SageContactReviewDialog
          open={sageReviewOpen}
          onOpenChange={setSageReviewOpen}
          canApprove={directoryAccess.canApproveSageReview}
        />
      ) : null}
    </>
  )
}
