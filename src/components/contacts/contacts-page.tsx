"use client"

import * as React from "react"
import { IconPlus, IconShieldCheck } from "@tabler/icons-react"
import { Plus } from "lucide-react"
import { useSearchParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { useRegisterPageActions } from "@/hooks/use-register-page-actions"

import {
  getCustomers,
  createCustomerDirectoryContact,
  updateCustomer,
  deleteCustomer,
  type CustomerRelationshipType,
} from "@/app/actions/customers"
import {
  getInternalDirectoryContacts,
  createVendor,
  updateVendor,
  deleteVendor,
  type InternalDirectoryContact,
  type VendorCompanyMutationInput,
} from "@/app/actions/vendors"
import { getContactDirectorySummary, getVendorDirectoryCompany } from "@/app/actions/contact-directory"
import type { Customer } from "@/db/schema"
import type { CustomerDirectoryPerson } from "@/app/actions/customer-people"
import { getMyContactRecords, type MyContactRecord } from "@/app/actions/my-contact-records"
import type { CustomerDirectoryRow, VendorDirectoryCompany, VendorDirectoryRow } from "@/lib/domain/contacts/directory-page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { CompassAccessDialog } from "@/components/contacts/compass-access-dialog"
import { CustomersTable } from "@/components/financials/customers-table"
import { CustomerDialog } from "@/components/financials/customer-dialog"
import { VendorsTable } from "@/components/financials/vendors-table"
import { VendorDialog } from "@/components/financials/vendor-dialog"
import { VendorTradeDocsDialog } from "@/components/financials/vendor-trade-docs-dialog"
import { CustomerPeopleDialog } from "@/components/contacts/customer-people-dialog"
import { DirectoryAccountLinkDialog, type DirectoryAccountLinkTarget } from "@/components/contacts/directory-account-link-dialog"
import { SageContactEditorDialog, type SageContactEditorTarget } from "@/components/contacts/sage-contact-editor-dialog"
import { SageContactReviewDialog } from "@/components/contacts/sage-contact-review-dialog"
import { SageContactLinkLookupDialog, type SageContactLinkLookupTarget } from "@/components/contacts/sage-contact-link-lookup-dialog"
import { SageContactCreateDialog, type SageContactCreateTarget } from "@/components/contacts/sage-contact-create-dialog"
import { SageClientMatchingDialog } from "@/components/contacts/sage-client-matching-dialog"
import { ContactMergeDialog } from "@/components/contacts/contact-merge-dialog"
import { CompanyMergePicker, type MergeChoice } from "@/components/contacts/company-merge-picker"
import { CompanySelectionBar } from "@/components/contacts/company-selection-bar"
import { InternalContactsTable } from "@/components/contacts/internal-contacts-table"
import { MyContactInformationDialog } from "@/components/contacts/my-contact-information-dialog"
import { ProjectAssociationConfirmDialog } from "@/components/contacts/project-association-confirm-dialog"
import { listMySageContactProposalStatuses, type MySageContactProposalStatus } from "@/app/actions/sage-contact-changes"
import { addCompaniesToProject } from "@/app/actions/contact-project-associations"
import { toContactsTab, type ContactsBootstrap, type ContactsTab } from "@/components/contacts/contacts-bootstrap"

type Tab = ContactsTab
type MergeKind = "customer_company" | "vendor_company" | "customer_person" | "vendor_person"
type MergeState = {
  readonly kind: MergeKind
  readonly choices: readonly [MergeChoice, MergeChoice] | null
  /** Set for "Merge with…": the row the merge started from; the picker finds the other. */
  readonly anchor: MergeChoice | null
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

function choice(record: { readonly id: string; readonly name: string; readonly email: string | null; readonly primaryEmail?: string | null }): MergeChoice {
  return { id: record.id, name: record.name, email: record.primaryEmail || record.email }
}

export function ContactsPageClient({ bootstrap }: { readonly bootstrap: ContactsBootstrap }) {
  return (
    <React.Suspense fallback={<ContactsSkeleton />}>
      <ContactsContent bootstrap={bootstrap} />
    </React.Suspense>
  )
}

export function ContactsSkeleton() {
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

function ContactsContent({ bootstrap }: { readonly bootstrap: ContactsBootstrap }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const directoryAccess = bootstrap.access
  const associationProjects = bootstrap.associationProjects

  const [tab, setTab] = React.useState<Tab>(() => {
    const requested = toContactsTab(searchParams.get("tab"))
    if (!directoryAccess || directoryAccess[requested].read) return requested
    return (["customers", "vendors", "internal"] as const).find((candidate) => directoryAccess[candidate].read) ?? requested
  })
  const [summary, setSummary] = React.useState(bootstrap.summary)
  const [internalContactsList, setInternalContactsList] = React.useState<readonly InternalDirectoryContact[]>(bootstrap.internal)
  // Bumped after a change so each list re-reads its current page.
  const [reloadToken, setReloadToken] = React.useState(0)
  const [clearSelectionToken, setClearSelectionToken] = React.useState(0)
  const [accessDialogOpen, setAccessDialogOpen] = React.useState(false)
  const [sageReviewOpen, setSageReviewOpen] = React.useState(false)
  const [sageMatchingCustomers, setSageMatchingCustomers] = React.useState<readonly Customer[] | null>(null)
  const [myContactsOpen, setMyContactsOpen] = React.useState(false)
  const [myContacts, setMyContacts] = React.useState<readonly MyContactRecord[]>([])
  const [myProposalStatuses, setMyProposalStatuses] = React.useState<readonly MySageContactProposalStatus[]>([])
  const [sageEditorTarget, setSageEditorTarget] = React.useState<SageContactEditorTarget | null>(null)
  const [sageLinkTarget, setSageLinkTarget] = React.useState<SageContactLinkLookupTarget | null>(null)
  const [sageCreateTarget, setSageCreateTarget] = React.useState<SageContactCreateTarget | null>(null)
  const [accountLinkTarget, setAccountLinkTarget] = React.useState<DirectoryAccountLinkTarget | null>(null)
  const [peopleCustomer, setPeopleCustomer] = React.useState<Customer | null>(null)
  const [associationProjectId, setAssociationProjectId] = React.useState("")
  const [selectedCustomers, setSelectedCustomers] = React.useState<readonly CustomerDirectoryRow[]>([])
  const [selectedVendors, setSelectedVendors] = React.useState<readonly VendorDirectoryRow[]>([])
  const [associationDialogOpen, setAssociationDialogOpen] = React.useState(false)
  const [associating, setAssociating] = React.useState(false)
  const [mergeSelection, setMergeSelection] = React.useState<MergeState | null>(null)
  const [customerDialogOpen, setCustomerDialogOpen] = React.useState(false)
  const [editingCustomer, setEditingCustomer] = React.useState<Customer | null>(null)
  const [vendorDialogOpen, setVendorDialogOpen] = React.useState(false)
  const [vendorReadOnly, setVendorReadOnly] = React.useState(false)
  const [editingVendor, setEditingVendor] = React.useState<VendorDirectoryCompany | null>(null)
  const [tradeDocsVendor, setTradeDocsVendor] = React.useState<{ readonly id: string; readonly name: string } | null>(null)
  const showTradeDocs = bootstrap.vendors?.tradeDocStatuses != null

  React.useEffect(() => {
    if (bootstrap.loadFailed) toast.error("Failed to load contacts")
  }, [bootstrap.loadFailed])

  // Notifications link here with ?tradeDocs=<vendor id> to open that vendor's trade docs.
  const tradeDocsParam = searchParams.get("tradeDocs")
  React.useEffect(() => {
    if (!tradeDocsParam || !showTradeDocs) return
    setTradeDocsVendor((current) => current ?? { id: tradeDocsParam, name: "" })
  }, [tradeDocsParam, showTradeDocs])

  const vendorCategories = React.useMemo(() => Array.from(
    new Set([...DEFAULT_VENDOR_CATEGORIES, ...summary.vendorCategories.filter((category) => category.toLowerCase() !== "internal")])
  ).sort((left, right) => left.localeCompare(right)), [summary.vendorCategories])

  /** Re-reads the visible pages, tab counts and the internal list after a change. */
  const refresh = React.useCallback(async () => {
    setReloadToken((token) => token + 1)
    const [nextSummary, internal] = await Promise.all([
      getContactDirectorySummary(),
      directoryAccess?.internal.read ? getInternalDirectoryContacts() : Promise.resolve(null),
    ])
    if (nextSummary.success) setSummary(nextSummary.data)
    if (internal) setInternalContactsList(internal)
  }, [directoryAccess])
  const reloadLists = React.useCallback(() => { void refresh() }, [refresh])

  const openMyContacts = React.useCallback(async () => {
    setMyContactsOpen(true)
    try {
      const [records, statuses] = await Promise.all([getMyContactRecords(), listMySageContactProposalStatuses()])
      setMyContacts(records)
      setMyProposalStatuses(statuses)
    } catch {
      toast.error("Could not load your contact information")
    }
  }, [])

  const openSageMatching = React.useCallback(async () => {
    try {
      setSageMatchingCustomers(await getCustomers())
    } catch {
      toast.error("Could not load clients for Sage matching")
    }
  }, [])

  const openCustomer = React.useCallback(() => {
    setEditingCustomer(null)
    setCustomerDialogOpen(true)
  }, [])

  const openVendor = React.useCallback(() => {
    setEditingVendor(null)
    setVendorReadOnly(false)
    setVendorDialogOpen(true)
  }, [])

  /** The page holds one summary row per vendor; its people load when the dialog opens. */
  const openVendorRecord = React.useCallback(async (vendor: VendorDirectoryRow, readOnly: boolean) => {
    const result = await getVendorDirectoryCompany(vendor.id)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    setEditingVendor(result.data)
    setVendorReadOnly(readOnly)
    setVendorDialogOpen(true)
  }, [])

  const pageActions = React.useMemo(() => {
    if (tab === "internal" || !directoryAccess?.[tab].create) return []
    return [tab === "customers"
      ? { id: "add-customer", label: "Add Client / Lead", onSelect: openCustomer, icon: Plus }
      : { id: "add-vendor", label: "Add Vendor", onSelect: openVendor, icon: Plus }]
  }, [tab, directoryAccess, openCustomer, openVendor])

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
      if (!result.success) {
        toast.error(result.error || "Failed")
        return
      }
      toast.success("Customer updated")
    } else {
      const result = await createCustomerDirectoryContact({
        ...data,
        company: data.company || null,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        notes: data.notes || null,
      })
      if (!result.success) {
        toast.error(result.error || "Failed")
        return
      }
      toast.success(result.existing ? "Existing client/lead contact selected" : "Client/lead contact added to Contacts")
    }
    setCustomerDialogOpen(false)
    await refresh()
  }

  const handleDeleteCustomer = React.useCallback(async (id: string) => {
    const result = await deleteCustomer(id)
    if (result.success) {
      toast.success("Customer deleted")
      await refresh()
    } else {
      toast.error(result.error || "Failed")
    }
  }, [refresh])

  const handleVendorSubmit = async (data: VendorCompanyMutationInput) => {
    const result = editingVendor ? await updateVendor(editingVendor.id, data) : await createVendor(data)
    if (!result.success) {
      toast.error(result.error || "Failed")
      return
    }
    toast.success(editingVendor ? "Vendor updated" : "Vendor created")
    setVendorDialogOpen(false)
    await refresh()
  }

  const handleDeleteVendor = React.useCallback(async (id: string) => {
    const result = await deleteVendor(id)
    if (result.success) {
      toast.success("Vendor deleted")
      await refresh()
    } else {
      toast.error(result.error || "Failed")
    }
  }, [refresh])

  const selectedCompanies: readonly MergeChoice[] = tab === "vendors"
    ? selectedVendors.map(choice)
    : tab === "customers" ? selectedCustomers.map(choice) : []
  const clearSelection = () => setClearSelectionToken((token) => token + 1)
  const openCompanyMerge = () => {
    const [first, second] = selectedCompanies
    if (selectedCompanies.length !== 2 || !first || !second || tab === "internal") return
    setMergeSelection({ kind: tab === "vendors" ? "vendor_company" : "customer_company", choices: [first, second], anchor: null })
  }
  const canMergeVendors = Boolean(directoryAccess?.vendors.edit && directoryAccess.vendors.delete)
  const canMergeCustomers = Boolean(directoryAccess?.customers.edit && directoryAccess.customers.delete)
  const mergeVendorWith = React.useCallback((vendor: VendorDirectoryRow) => {
    setMergeSelection({ kind: "vendor_company", choices: null, anchor: choice(vendor) })
  }, [])
  const mergeCustomerWith = React.useCallback((customer: CustomerDirectoryRow) => {
    setMergeSelection({ kind: "customer_company", choices: null, anchor: choice(customer) })
  }, [])

  const handleAssociateCompanies = async () => {
    const ids = selectedCompanies.map((company) => company.id)
    if (!associationProjectId || ids.length === 0 || ids.length > 100 || tab === "internal") return
    setAssociating(true)
    try {
      const result = await addCompaniesToProject({ kind: tab === "vendors" ? "vendor" : "customer", ids, projectId: associationProjectId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.warning) toast.warning(result.warning)
      toast.success(`${result.added} added to project${result.existing > 0 ? `; ${result.existing} already associated` : ""}. No Compass access was granted.`)
      clearSelection()
      setAssociationDialogOpen(false)
    } catch {
      toast.error("Could not complete the project association. Please refresh and check Project Contacts before retrying.")
    } finally {
      setAssociating(false)
    }
  }

  const viewVendor = React.useCallback((vendor: VendorDirectoryRow) => { void openVendorRecord(vendor, true) }, [openVendorRecord])
  const editVendor = React.useCallback((vendor: VendorDirectoryRow) => { void openVendorRecord(vendor, false) }, [openVendorRecord])
  const editCustomer = React.useCallback((customer: Customer) => {
    setEditingCustomer(customer)
    setCustomerDialogOpen(true)
  }, [])
  const openTradeDocs = React.useCallback((vendor: VendorDirectoryRow) => setTradeDocsVendor({ id: vendor.id, name: vendor.name }), [])
  const deleteVendorRow = React.useCallback((id: string) => { void handleDeleteVendor(id) }, [handleDeleteVendor])
  const deleteCustomerRow = React.useCallback((id: string) => { void handleDeleteCustomer(id) }, [handleDeleteCustomer])

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
          <Button variant="outline" size="sm" onClick={() => void openMyContacts()}>My contact information</Button>
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
          onSubmitted={reloadLists}
        />
      </>
    )
  }

  const addLabel = tab === "customers" ? "Add Client / Lead" : "Add Vendor"
  const addHandler = tab === "customers" ? openCustomer : openVendor
  const canMergeTab = tab === "vendors" ? canMergeVendors : canMergeCustomers
  const mergeAnchor = mergeSelection?.anchor ?? null

  return (
    <>
      <div className="flex flex-1 flex-col min-h-0 p-4 sm:px-6 md:px-8 pt-3 gap-3">
        <Tabs value={tab} onValueChange={handleTabChange} className="flex flex-1 flex-col min-h-0">
          <div className="flex items-center justify-between gap-3 shrink-0">
            <TabsList>
              <TabsTrigger value="customers" disabled={!directoryAccess?.customers.read} className="text-xs sm:text-sm">
                Clients & Leads
                <span className="ml-1.5 text-muted-foreground tabular-nums">{summary.customerCount}</span>
              </TabsTrigger>
              <TabsTrigger value="vendors" disabled={!directoryAccess?.vendors.read} className="text-xs sm:text-sm">
                Vendors
                <span className="ml-1.5 text-muted-foreground tabular-nums">{summary.vendorCount}</span>
              </TabsTrigger>
              <TabsTrigger value="internal" disabled={!directoryAccess?.internal.read} className="text-xs sm:text-sm">
                Internal
                <span className="ml-1.5 text-muted-foreground tabular-nums">{summary.internalCount}</span>
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" onClick={() => void openMyContacts()}>My contact information</Button>
              {tab === "customers" && directoryAccess?.canReadSageReview ? (
                <Button variant="outline" size="sm" className="h-8" onClick={() => void openSageMatching()}>Match with Sage</Button>
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

          {tab !== "internal" && (associationProjects.length > 0 || canMergeTab) ? (
            <CompanySelectionBar
              noun={tab === "vendors" ? "vendors" : "clients/leads"}
              selectedCount={selectedCompanies.length}
              projects={associationProjects}
              projectId={associationProjectId}
              onProjectChange={setAssociationProjectId}
              onAssociate={() => setAssociationDialogOpen(true)}
              canMerge={canMergeTab}
              onMerge={openCompanyMerge}
              onClear={clearSelection}
            />
          ) : tab !== "internal" && directoryAccess?.canManageAccounts ? (
            <p className="mt-2 text-xs text-muted-foreground">To grant people project access, select their accounts in Manage Compass access.</p>
          ) : null}

          <TabsContent value="customers" className="mt-3 flex-1 min-h-0 flex flex-col">
            <CustomersTable
              initialPage={bootstrap.customers}
              reloadToken={reloadToken}
              clearSelectionToken={clearSelectionToken}
              onViewPeople={setPeopleCustomer}
              onEdit={directoryAccess?.customers.edit ? editCustomer : undefined}
              onDelete={directoryAccess?.customers.delete ? deleteCustomerRow : undefined}
              onMergeWith={canMergeCustomers ? mergeCustomerWith : undefined}
              onSelectionChange={associationProjects.length > 0 || canMergeCustomers ? setSelectedCustomers : undefined}
            />
          </TabsContent>

          <TabsContent value="vendors" className="mt-3 flex-1 min-h-0 flex flex-col">
            <VendorsTable
              categories={vendorCategories}
              initialPage={bootstrap.vendors}
              reloadToken={reloadToken}
              clearSelectionToken={clearSelectionToken}
              onView={viewVendor}
              onEdit={directoryAccess?.vendors.edit ? editVendor : undefined}
              onDelete={directoryAccess?.vendors.delete ? deleteVendorRow : undefined}
              onTradeDocs={showTradeDocs ? openTradeDocs : undefined}
              onMergeWith={canMergeVendors ? mergeVendorWith : undefined}
              onSelectionChange={associationProjects.length > 0 || canMergeVendors ? setSelectedVendors : undefined}
            />
            {tradeDocsVendor && (
              <VendorTradeDocsDialog
                vendorId={tradeDocsVendor.id}
                vendorName={tradeDocsVendor.name}
                open
                onOpenChange={(next) => !next && setTradeDocsVendor(null)}
                onChanged={() => setReloadToken((token) => token + 1)}
              />
            )}
          </TabsContent>

          <TabsContent value="internal" className="mt-3 flex-1 min-h-0 flex flex-col">
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
            clearSelection()
            setPeopleCustomer(null)
            setVendorDialogOpen(false)
            void refresh()
          }}
          picker={mergeAnchor ? (
            <CompanyMergePicker
              kind={mergeSelection.kind === "vendor_company" ? "vendor" : "customer"}
              anchor={mergeAnchor}
              selectedId={mergeSelection.choices?.find((item) => item.id !== mergeAnchor.id)?.id ?? null}
              onSelect={(other) => setMergeSelection({ ...mergeSelection, choices: [mergeAnchor, other] })}
            />
          ) : undefined}
        />
      ) : null}
      {directoryAccess?.canReadSageReview && directoryAccess.customers.read ? (
        <SageClientMatchingDialog
          open={sageMatchingCustomers !== null}
          onOpenChange={(open) => { if (!open) setSageMatchingCustomers(null) }}
          customers={sageMatchingCustomers ?? []}
          onVerify={(customer, sageNumber) => setSageLinkTarget({
            kind: "client_company", entityId: customer.id, name: customer.name,
            sageRecordNumber: sageNumber,
          })}
          onOpenCustomer={editCustomer}
          onOpenReview={() => setSageReviewOpen(true)}
        />
      ) : null}

      <ProjectAssociationConfirmDialog
        open={associationDialogOpen}
        onOpenChange={setAssociationDialogOpen}
        count={selectedCompanies.length}
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
        onMergePeople={canMergeVendors ? (people) => {
          setVendorDialogOpen(false)
          setMergeSelection({ kind: "vendor_person", choices: [choice(people[0]), choice(people[1])], anchor: null })
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
        onMergePeople={canMergeCustomers ? (people) => {
          setPeopleCustomer(null)
          setMergeSelection({ kind: "customer_person", choices: [choice(people[0]), choice(people[1])], anchor: null })
        } : undefined}
      />
      <SageContactEditorDialog
        key={sageEditorTarget ? `${sageEditorTarget.kind}:${sageEditorTarget.entityId}` : "none"}
        target={sageEditorTarget}
        onOpenChange={(open) => { if (!open) setSageEditorTarget(null) }}
        onSubmitted={reloadLists}
      />
      <SageContactLinkLookupDialog
        key={sageLinkTarget ? `${sageLinkTarget.kind}:${sageLinkTarget.entityId}` : "none"}
        target={sageLinkTarget}
        onOpenChange={(open) => { if (!open) setSageLinkTarget(null) }}
        onRequested={reloadLists}
      />
      <SageContactCreateDialog
        key={sageCreateTarget ? `${sageCreateTarget.kind}:${sageCreateTarget.companyId}` : "none"}
        target={sageCreateTarget}
        onOpenChange={(open) => { if (!open) setSageCreateTarget(null) }}
        onSubmitted={reloadLists}
      />
      <DirectoryAccountLinkDialog
        key={accountLinkTarget ? `${accountLinkTarget.kind}:${accountLinkTarget.personId}` : "none"}
        target={accountLinkTarget}
        onOpenChange={(open) => { if (!open) setAccountLinkTarget(null) }}
        onLinked={reloadLists}
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
