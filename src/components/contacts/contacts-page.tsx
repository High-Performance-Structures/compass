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
import { CompassAccessDialog } from "@/components/contacts/compass-access-dialog"
import { CustomersTable } from "@/components/financials/customers-table"
import { CustomerDialog } from "@/components/financials/customer-dialog"
import { VendorsTable } from "@/components/financials/vendors-table"
import { VendorDialog } from "@/components/financials/vendor-dialog"
import { VendorTradeDocsDialog } from "@/components/financials/vendor-trade-docs-dialog"
import { getVendorTradeDocStatuses, type VendorTradeDocStatus } from "@/app/actions/vendor-trade-docs"
import { CustomerPeopleDialog } from "@/components/contacts/customer-people-dialog"
import { DirectoryAccountLinkDialog, type DirectoryAccountLinkTarget } from "@/components/contacts/directory-account-link-dialog"
import { SageContactEditorDialog, type SageContactEditorTarget } from "@/components/contacts/sage-contact-editor-dialog"
import { SageContactReviewDialog } from "@/components/contacts/sage-contact-review-dialog"
import { SageContactLinkLookupDialog, type SageContactLinkLookupTarget } from "@/components/contacts/sage-contact-link-lookup-dialog"
import { SageContactCreateDialog, type SageContactCreateTarget } from "@/components/contacts/sage-contact-create-dialog"
import { SageClientMatchingDialog } from "@/components/contacts/sage-client-matching-dialog"
import { ContactMergeDialog } from "@/components/contacts/contact-merge-dialog"
import { InternalContactsTable } from "@/components/contacts/internal-contacts-table"
import { MyContactInformationDialog } from "@/components/contacts/my-contact-information-dialog"
import { ProjectAssociationConfirmDialog } from "@/components/contacts/project-association-confirm-dialog"
import { listMySageContactProposalStatuses, type MySageContactProposalStatus } from "@/app/actions/sage-contact-changes"
import { addCompaniesToProject, getCompanyAssociationProjects } from "@/app/actions/contact-project-associations"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { projectNumberAndName } from "@/lib/project-display-name"

type Tab = "customers" | "vendors" | "internal"
type DirectoryCapabilities = Record<Tab, ContactDirectoryAccess> & {
  readonly canManageAccounts: boolean
  readonly canReadSageReview: boolean
  readonly canApproveSageReview: boolean
  readonly canReadEmployeePrivate: boolean
  readonly canCreateSagePeople: boolean
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

export function ContactsPageClient() {
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
  const [sageClientMatchingOpen, setSageClientMatchingOpen] = React.useState(false)
  const [myContactsOpen, setMyContactsOpen] = React.useState(false)
  const [myContacts, setMyContacts] = React.useState<readonly MyContactRecord[]>([])
  const [myProposalStatuses, setMyProposalStatuses] = React.useState<readonly MySageContactProposalStatus[]>([])
  const [sageEditorTarget, setSageEditorTarget] = React.useState<SageContactEditorTarget | null>(null)
  const [sageLinkTarget, setSageLinkTarget] = React.useState<SageContactLinkLookupTarget | null>(null)
  const [sageCreateTarget, setSageCreateTarget] = React.useState<SageContactCreateTarget | null>(null)
  const [accountLinkTarget, setAccountLinkTarget] = React.useState<DirectoryAccountLinkTarget | null>(null)
  const [peopleCustomer, setPeopleCustomer] = React.useState<Customer | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [directoryAccess, setDirectoryAccess] = React.useState<DirectoryCapabilities | null>(null)
  const [associationProjects, setAssociationProjects] = React.useState<readonly { readonly id: string; readonly name: string; readonly projectNumber: string | null }[]>([])
  const [associationProjectId, setAssociationProjectId] = React.useState("")
  const [selectedCustomers, setSelectedCustomers] = React.useState<readonly string[]>([])
  const [selectedVendors, setSelectedVendors] = React.useState<readonly string[]>([])
  const [associationDialogOpen, setAssociationDialogOpen] = React.useState(false)
  const [associating, setAssociating] = React.useState(false)
  const [mergeSelection, setMergeSelection] = React.useState<{
    readonly kind: "customer_company" | "vendor_company" | "customer_person" | "vendor_person"
    readonly choices: readonly [
      { readonly id: string; readonly name: string; readonly email: string | null },
      { readonly id: string; readonly name: string; readonly email: string | null },
    ]
  } | null>(null)

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
  // Staff only: null when trade docs aren't available to this user.
  const [tradeDocStatuses, setTradeDocStatuses] = React.useState<Readonly<Record<string, VendorTradeDocStatus>> | null>(null)
  const [tradeDocsVendor, setTradeDocsVendor] = React.useState<{ readonly id: string; readonly name: string } | null>(null)
  // Notifications link here with ?tradeDocs=<vendor id> to open that vendor's trade docs.
  const tradeDocsParam = searchParams.get("tradeDocs")
  React.useEffect(() => {
    if (!tradeDocsParam || !tradeDocStatuses) return
    setTradeDocsVendor((current) => current ?? { id: tradeDocsParam, name: "" })
  }, [tradeDocsParam, tradeDocStatuses])
  const loadTradeDocStatuses = React.useCallback(async () => {
    const result = await getVendorTradeDocStatuses()
    setTradeDocStatuses(result.success ? result.data : null)
  }, [])
  const [editingVendor, setEditingVendor] =
    React.useState<VendorDirectoryCompany | null>(null)

  const vendorContacts = React.useMemo(
    () => vendorsList.filter((vendor) => !isInternalVendor(vendor)),
    [vendorsList]
  )
  const vendorCategories = React.useMemo(() => Array.from(
    new Set([
      ...DEFAULT_VENDOR_CATEGORIES,
      ...vendorContacts
        .map((vendor) => vendor.category?.trim())
        .filter((category): category is string => {
          return Boolean(category) && category.toLowerCase() !== "internal"
        }),
    ])
  ).sort((left, right) => left.localeCompare(right)), [vendorContacts])

  const loadAll = React.useCallback(async () => {
    try {
      const access = await getContactDirectoryAccess()
      const [customers, vendors, internalContacts, myRecords, myStatuses, projects] = await Promise.all([
        access.customers.read ? getCustomers() : Promise.resolve([]),
        access.vendors.read ? getVendors() : Promise.resolve([]),
        access.internal.read ? getInternalDirectoryContacts() : Promise.resolve([]),
        getMyContactRecords(),
        listMySageContactProposalStatuses(),
        getCompanyAssociationProjects(),
      ])
      setDirectoryAccess(access)
      setTab((currentTab) => {
        if (access[currentTab].read) return currentTab
        return (["customers", "vendors", "internal"] as const).find((candidate) => access[candidate].read) ?? currentTab
      })
      setCustomersList(customers)
      setVendorsList(vendors)
      if (access.vendors.read) void loadTradeDocStatuses()
      setInternalContactsList(internalContacts)
      setMyContacts(myRecords)
      setMyProposalStatuses(myStatuses)
      setAssociationProjects(projects)
    } catch {
      toast.error("Failed to load contacts")
    } finally {
      setLoading(false)
    }
  }, [loadTradeDocStatuses])

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

  const selectedCompanyIds = tab === "vendors" ? selectedVendors : selectedCustomers
  const openCompanyMerge = () => {
    if (selectedCompanyIds.length !== 2 || tab === "internal") return
    const selected = tab === "vendors"
      ? vendorContacts.filter((vendor) => selectedCompanyIds.includes(vendor.id))
      : customersList.filter((customer) => selectedCompanyIds.includes(customer.id))
    const first = selected[0]
    const second = selected[1]
    if (!first || !second) return
    setMergeSelection({
      kind: tab === "vendors" ? "vendor_company" : "customer_company",
      choices: [
        { id: first.id, name: first.name, email: first.email },
        { id: second.id, name: second.name, email: second.email },
      ],
    })
  }
  const handleAssociateCompanies = async () => {
    if (!associationProjectId || selectedCompanyIds.length === 0 || selectedCompanyIds.length > 100 || tab === "internal") return
    setAssociating(true)
    try {
      const result = await addCompaniesToProject({
        kind: tab === "vendors" ? "vendor" : "customer",
        ids: selectedCompanyIds,
        projectId: associationProjectId,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.warning) toast.warning(result.warning)
      toast.success(`${result.added} added to project${result.existing > 0 ? `; ${result.existing} already associated` : ""}. No Compass access was granted.`)
      if (tab === "vendors") setSelectedVendors([])
      else setSelectedCustomers([])
      setAssociationDialogOpen(false)
    } catch {
      toast.error("Could not complete the project association. Please refresh and check Project Contacts before retrying.")
    } finally {
      setAssociating(false)
    }
  }

  if (loading) {
    return <ContactsSkeleton />
  }

  const accessManagerDialog = directoryAccess?.canManageAccounts ? (
    <CompassAccessDialog
      open={accessDialogOpen}
      onOpenChange={setAccessDialogOpen}
      initialSection={tab === "customers" ? "clients" : tab}
    />
  ) : null

  const myContactsDialog = (
    <MyContactInformationDialog
      open={myContactsOpen}
      onOpenChange={setMyContactsOpen}
      myContacts={myContacts}
      myProposalStatuses={myProposalStatuses}
      onProposeEdit={(record) => {
        setMyContactsOpen(false)
        setSageEditorTarget({ kind: record.kind, entityId: record.entityId, name: record.name })
      }}
    />
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

  const addLabel = tab === "customers" ? "Add Client / Lead" : "Add Vendor"
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
              {tab === "customers" && directoryAccess?.canReadSageReview ? (
                <Button variant="outline" size="sm" className="h-8" onClick={() => setSageClientMatchingOpen(true)}>Match with Sage</Button>
              ) : null}
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

          {tab !== "internal" && (associationProjects.length > 0 || (directoryAccess?.[tab].edit && directoryAccess?.[tab].delete)) ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-b pb-2 text-sm">
              <span className="text-muted-foreground">{selectedCompanyIds.length} {tab === "vendors" ? "vendors" : "clients/leads"} selected</span>
              {associationProjects.length > 0 ? <SearchableCombobox
                ariaLabel="Choose project for selected companies"
                options={associationProjects.map((project) => ({
                  value: project.id,
                  label: project.projectNumber ? projectNumberAndName(project, " · ") : project.name,
                }))}
                value={associationProjectId}
                onValueChange={setAssociationProjectId}
                placeholder="Choose project..."
                searchPlaceholder="Search projects..."
                className="w-72"
              /> : null}
              {associationProjects.length > 0 ? <Button type="button" size="sm" disabled={selectedCompanyIds.length === 0 || selectedCompanyIds.length > 100 || !associationProjectId} onClick={() => setAssociationDialogOpen(true)}>
                Add selected to project
              </Button> : null}
              {directoryAccess?.[tab].edit && directoryAccess?.[tab].delete ? (
                <Button type="button" size="sm" variant="outline" disabled={selectedCompanyIds.length !== 2} onClick={openCompanyMerge}>
                  Merge 2 duplicates
                </Button>
              ) : null}
              {selectedCompanyIds.length > 0 ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => tab === "vendors" ? setSelectedVendors([]) : setSelectedCustomers([])}>Clear selection</Button>
              ) : null}
              <span className="text-xs text-muted-foreground">{selectedCompanyIds.length > 100 ? "Choose at most 100 records per batch. " : ""}Project association and duplicate merging never grant Compass access.</span>
            </div>
          ) : tab !== "internal" && directoryAccess?.canManageAccounts ? (
            <p className="mt-2 text-xs text-muted-foreground">To grant people project access, select their accounts in Manage Compass access.</p>
          ) : null}

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
              selectedIds={selectedCustomers}
              onSelectionChange={associationProjects.length > 0 || (directoryAccess?.customers.edit && directoryAccess.customers.delete) ? setSelectedCustomers : undefined}
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
              tradeDocStatuses={tradeDocStatuses ?? undefined}
              onTradeDocs={tradeDocStatuses ? (vendor) => setTradeDocsVendor({ id: vendor.id, name: vendor.name }) : undefined}
              selectedIds={selectedVendors}
              onSelectionChange={associationProjects.length > 0 || (directoryAccess?.vendors.edit && directoryAccess.vendors.delete) ? setSelectedVendors : undefined}
            />
            {tradeDocsVendor && (
              <VendorTradeDocsDialog
                vendorId={tradeDocsVendor.id}
                vendorName={tradeDocsVendor.name}
                open
                onOpenChange={(next) => !next && setTradeDocsVendor(null)}
                onChanged={() => void loadTradeDocStatuses()}
              />
            )}
          </TabsContent>

          <TabsContent
            value="internal"
            className="mt-3 flex-1 min-h-0 flex flex-col"
          >
            <InternalContactsTable
              contacts={internalContactsList}
              onSageEdit={directoryAccess?.internal.edit ? (contact) => setSageEditorTarget({ kind: "employee", entityId: contact.id, name: contact.name }) : undefined}
              onSageLink={directoryAccess?.canReadSageReview && directoryAccess.canReadEmployeePrivate && directoryAccess.internal.read ? (contact) => setSageLinkTarget({ kind: "employee", entityId: contact.id, name: contact.name, sageRecordNumber: contact.sageEmployeeNumber }) : undefined}
            />
          </TabsContent>
        </Tabs>
      </div>

      {accessManagerDialog}
      {myContactsDialog}
      {mergeSelection ? (
        <ContactMergeDialog
          kind={mergeSelection.kind}
          choices={mergeSelection.choices}
          onOpenChange={(open) => { if (!open) setMergeSelection(null) }}
          onMerged={() => {
            setSelectedCustomers([])
            setSelectedVendors([])
            setPeopleCustomer(null)
            setVendorDialogOpen(false)
            void loadAll()
          }}
        />
      ) : null}
      {directoryAccess?.canReadSageReview && directoryAccess.customers.read ? (
        <SageClientMatchingDialog
          open={sageClientMatchingOpen}
          onOpenChange={setSageClientMatchingOpen}
          customers={customersList}
          onVerify={(customer, sageNumber) => setSageLinkTarget({
            kind: "client_company", entityId: customer.id, name: customer.name,
            sageRecordNumber: sageNumber,
          })}
          onOpenCustomer={(customer) => {
            setEditingCustomer(customer)
            setCustomerDialogOpen(true)
          }}
          onOpenReview={() => setSageReviewOpen(true)}
        />
      ) : null}

      <ProjectAssociationConfirmDialog
        open={associationDialogOpen}
        onOpenChange={setAssociationDialogOpen}
        count={selectedCompanyIds.length}
        projectName={associationProjects.find((project) => project.id === associationProjectId)?.name ?? "the selected project"}
        associating={associating}
        onConfirm={() => void handleAssociateCompanies()}
      />

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
        onSageLinkCompany={editingCustomer && directoryAccess?.canReadSageReview ? () => {
          setCustomerDialogOpen(false)
          setSageLinkTarget({ kind: "client_company", entityId: editingCustomer.id, name: editingCustomer.name, sageRecordNumber: editingCustomer.sageClientNumber })
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
        onSageLinkCompany={editingVendor && directoryAccess?.canReadSageReview ? () => {
          setVendorDialogOpen(false)
          setSageLinkTarget({ kind: "vendor_company", entityId: editingVendor.id, name: editingVendor.name, sageRecordNumber: editingVendor.sageVendorNumber })
        } : undefined}
        onSageEditContact={directoryAccess?.vendors.edit ? (contactId, name) => {
          setVendorDialogOpen(false)
          setSageEditorTarget({ kind: "vendor_person", entityId: contactId, name })
        } : undefined}
        onSageLinkContact={directoryAccess?.canReadSageReview ? (contactId, name, lineNumber) => {
          setVendorDialogOpen(false)
          setSageLinkTarget({ kind: "vendor_person", entityId: contactId, name, sageRecordNumber: lineNumber === null ? null : String(lineNumber) })
        } : undefined}
        onSageCreateContact={directoryAccess?.canCreateSagePeople && directoryAccess.vendors.create && editingVendor?.sageVendorId ? () => {
          setVendorDialogOpen(false)
          setSageCreateTarget({ kind: "vendor_person", companyId: editingVendor.id, companyName: editingVendor.name })
        } : undefined}
        onLinkAccount={directoryAccess?.canManageAccounts ? (contactId, name, userId) => {
          setVendorDialogOpen(false)
          setAccountLinkTarget({ kind: "vendor_person", personId: contactId, name, userId })
        } : undefined}
        onMergePeople={directoryAccess?.vendors.edit && directoryAccess.vendors.delete ? (people) => {
          setVendorDialogOpen(false)
          setMergeSelection({
            kind: "vendor_person",
            choices: [
              { id: people[0].id, name: people[0].name, email: people[0].email },
              { id: people[1].id, name: people[1].name, email: people[1].email },
            ],
          })
        } : undefined}
      />
      <CustomerPeopleDialog
        key={peopleCustomer?.id ?? "none"}
        customer={peopleCustomer ? { id: peopleCustomer.id, name: peopleCustomer.name, sageLinked: Boolean(peopleCustomer.sageClientId || peopleCustomer.sageClientNumber), sageVerified: Boolean(peopleCustomer.sageClientId) } : null}
        onOpenChange={(open) => { if (!open) setPeopleCustomer(null) }}
        canEdit={directoryAccess?.customers.edit ?? false}
        canCreate={directoryAccess?.customers.create ?? false}
        canDelete={directoryAccess?.customers.delete ?? false}
        canLinkAccounts={directoryAccess?.canManageAccounts ?? false}
        onSageEdit={(person: CustomerDirectoryPerson) => {
          setPeopleCustomer(null)
          setSageEditorTarget({ kind: "client_person", entityId: person.id, name: person.name })
        }}
        onSageLink={directoryAccess?.canReadSageReview ? (person: CustomerDirectoryPerson) => {
          setPeopleCustomer(null)
          setSageLinkTarget({ kind: "client_person", entityId: person.id, name: person.name, sageRecordNumber: person.sageLineNumber === null ? null : String(person.sageLineNumber) })
        } : undefined}
        onSageCreate={directoryAccess?.canCreateSagePeople && directoryAccess.customers.create && peopleCustomer?.sageClientId ? () => {
          setPeopleCustomer(null)
          setSageCreateTarget({ kind: "client_person", companyId: peopleCustomer.id, companyName: peopleCustomer.name })
        } : undefined}
        onVerifySageCompany={directoryAccess?.canReadSageReview && peopleCustomer && !peopleCustomer.sageClientId ? () => {
          setPeopleCustomer(null)
          setSageLinkTarget({
            kind: "client_company", entityId: peopleCustomer.id, name: peopleCustomer.name,
            sageRecordNumber: peopleCustomer.sageClientNumber,
          })
        } : undefined}
        onLinkAccount={(person: CustomerDirectoryPerson) => {
          setPeopleCustomer(null)
          setAccountLinkTarget({ kind: "client_person", personId: person.id, name: person.name, userId: person.userId })
        }}
        onMergePeople={directoryAccess?.customers.edit && directoryAccess.customers.delete ? (people) => {
          setPeopleCustomer(null)
          setMergeSelection({
            kind: "customer_person",
            choices: [
              { id: people[0].id, name: people[0].name, email: people[0].email },
              { id: people[1].id, name: people[1].name, email: people[1].email },
            ],
          })
        } : undefined}
      />
      <SageContactEditorDialog
        key={sageEditorTarget ? `${sageEditorTarget.kind}:${sageEditorTarget.entityId}` : "none"}
        target={sageEditorTarget}
        onOpenChange={(open) => { if (!open) setSageEditorTarget(null) }}
        onSubmitted={() => { void loadAll() }}
      />
      <SageContactLinkLookupDialog
        key={sageLinkTarget ? `${sageLinkTarget.kind}:${sageLinkTarget.entityId}` : "none"}
        target={sageLinkTarget}
        onOpenChange={(open) => { if (!open) setSageLinkTarget(null) }}
        onRequested={() => { void loadAll() }}
      />
      <SageContactCreateDialog
        key={sageCreateTarget ? `${sageCreateTarget.kind}:${sageCreateTarget.companyId}` : "none"}
        target={sageCreateTarget}
        onOpenChange={(open) => { if (!open) setSageCreateTarget(null) }}
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
          canCreateSagePeople={directoryAccess.canCreateSagePeople}
        />
      ) : null}
    </>
  )
}
