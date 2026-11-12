"use client"

import * as React from "react"
import { IconPlus, IconTrash } from "@tabler/icons-react"
import type { VendorCompanyMutationInput } from "@/app/actions/vendors"
import type { VendorContactItem, VendorDirectoryCompany } from "@/lib/domain/contacts/directory-page"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { requestSageLinkedVendorChanges } from "@/app/actions/sage-linked-edits"
import { updateVendor } from "@/app/actions/vendors"
import { SageCompanyNameRow } from "@/components/contacts/sage-contact-editor-dialog"
import type { SagePendingChange } from "@/app/actions/sage-linked-edits"
import {
  announceSageOutcomes,
  SageFieldNote,
  sageFieldNote,
  SagePendingMarker,
  SagePendingNotice,
  sageSaveNote,
  useSageLinkedEditState,
} from "@/components/contacts/sage-linked-edit"
import { isSageLinkedPerson } from "@/lib/sage/contact-edit-gate"
import { SAGE_FIELD_LABELS } from "@/lib/sage/sage-linked-edit-fields"
import { SageNumberBadge } from "@/components/sage-number-badge"
import { toast } from "sonner"

/** Company fields shared with Sage, edited inline on a Sage-linked vendor. */
const SAGE_COMPANY_FIELDS = [
  "ownerName", "primaryEmail", "addressLine1", "addressLine2", "city", "state", "postalCode",
] as const
type SageCompanyField = "name" | "email" | "phone" | (typeof SAGE_COMPANY_FIELDS)[number]
type SageCompanyDraft = Readonly<Record<SageCompanyField, string>>

function sageCompanyDraft(vendor: VendorDirectoryCompany | null | undefined): SageCompanyDraft {
  return {
    name: vendor?.name ?? "", email: vendor?.email ?? "", phone: vendor?.phone ?? "",
    ownerName: vendor?.ownerName ?? "", primaryEmail: vendor?.primaryEmail ?? "",
    addressLine1: vendor?.addressLine1 ?? "", addressLine2: vendor?.addressLine2 ?? "",
    city: vendor?.city ?? "", state: vendor?.state ?? "", postalCode: vendor?.postalCode ?? "",
  }
}

type ContactDraft = {
  readonly key: string
  readonly id: string | null
  readonly name: string
  readonly title: string
  readonly email: string
  readonly phone: string
  readonly isPrimary: boolean
}

interface VendorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: VendorDirectoryCompany | null
  categories: readonly string[]
  onSubmit: (data: VendorCompanyMutationInput) => void
  /** After a Sage-linked vendor saves inline: refresh the directory. */
  onSageLinkedSaved?: () => void
  onSageLinkContact?: (contactId: string, name: string, lineNumber: number | null) => void
  onSageCreateContact?: () => void
  onSageLinkCompany?: () => void
  onLinkAccount?: (contactId: string, name: string, userId: string | null) => void
  onMergePeople?: (people: readonly [VendorContactItem, VendorContactItem]) => void
  /** "Request add to Sage" for this vendor or one of its people not in Sage. */
  onRequestSageAdd?: (kind: "vendor_company" | "vendor_person", entityId: string) => void
  readOnly?: boolean
}

export function VendorDialog({
  open,
  onOpenChange,
  initialData,
  categories,
  onSubmit,
  onSageLinkedSaved,
  onSageLinkContact,
  onSageCreateContact,
  onSageLinkCompany,
  onLinkAccount,
  onMergePeople,
  onRequestSageAdd,
  readOnly = false,
}: VendorDialogProps) {
  const [name, setName] = React.useState("")
  const [category, setCategory] = React.useState("Subcontractor")
  // The company's vendor types, plus a vendor's older type until it is changed.
  const categoryOptions = React.useMemo(
    () =>
      [...categories, ...(category && !categories.includes(category) ? [category] : [])].map((option) => ({
        value: option,
        label: categories.includes(option) ? option : `${option} (old type)`,
      })),
    [categories, category],
  )
  const [email, setEmail] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [address, setAddress] = React.useState("")
  const [contacts, setContacts] = React.useState<readonly ContactDraft[]>([])
  const [selectedPeopleIds, setSelectedPeopleIds] = React.useState<readonly string[]>([])
  const [sageDraft, setSageDraft] = React.useState<SageCompanyDraft>(() => sageCompanyDraft(initialData))
  const [saving, setSaving] = React.useState(false)
  const sageLinked = Boolean(initialData?.sageVendorId || initialData?.sageVendorNumber)
  const sageVerified = Boolean(initialData?.sageVendorId)
  // Primary belongs to the people Sage manages, so it stays put on a Sage-linked vendor.
  const locked = sageLinked || readOnly
  const { state: sageState, reload: reloadSageState } = useSageLinkedEditState(
    "vendor_company", sageLinked && open && initialData ? initialData.id : null, !readOnly)
  // Sage's people are edited here too: their changes become Sage change
  // requests. Compass-only people (no Sage ids) save directly and never
  // become primary.
  const sagePersonIds = React.useMemo(
    () => new Set((initialData?.contacts ?? []).filter(isSageLinkedPerson).map((contact) => contact.id)),
    [initialData],
  )
  const isSagePerson = (contact: ContactDraft): boolean => contact.id !== null && sagePersonIds.has(contact.id)
  // Every field always saves in Compass; the notes only say what Sage does with it.
  const personSaveNote = (contact: ContactDraft): string | null => {
    if (readOnly || !sageLinked || !contact.id || !isSagePerson(contact)) return null
    // Without its own and its company's Sage ids a person is not addressable in Sage.
    const verified = sageVerified && Boolean(initialData?.contacts.some((saved) => saved.id === contact.id && saved.sageContactId))
    return sageSaveNote(sageState, contact.id, { verified })
  }
  const companyFieldNote = (field: SageCompanyField): string | null => readOnly ? null : sageFieldNote(sageState, field)
  const companySaveNote = !readOnly && initialData ? sageSaveNote(sageState, initialData.id, { verified: sageVerified }) : null
  const categoryLockedReason = readOnly
    ? "Read only"
    : sageState?.categoryFromSageType
      ? `Follows the Sage vendor type "${sageState.categoryFromSageType}". Change the type in Sage.`
      : null

  React.useEffect(() => {
    setSelectedPeopleIds([])
    setSageDraft(sageCompanyDraft(initialData))
    if (initialData) {
      setName(initialData.name)
      setCategory(initialData.category)
      setEmail(initialData.email ?? "")
      setPhone(initialData.phone ?? "")
      setAddress(initialData.address ?? "")
      setContacts(
        initialData.contacts.map((contact) => ({
          key: contact.id,
          id: contact.id,
          name: contact.name,
          title: contact.title ?? "",
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          isPrimary: contact.isPrimary,
        }))
      )
    } else {
      setName("")
      setCategory("Subcontractor")
      setEmail("")
      setPhone("")
      setAddress("")
      setContacts([])
    }
  }, [initialData, open])

  const contactPayload = () => contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    title: contact.title,
    email: contact.email,
    phone: contact.phone,
    isPrimary: contact.isPrimary,
  }))

  /**
   * Compass-only fields (category, Compass-only people) save with the normal
   * vendor update, with Sage people passed as saved; then Sage-shared changes
   * go to Sage as change requests.
   */
  const saveSageLinked = async () => {
    if (!initialData) return
    setSaving(true)
    try {
      const savedById = new Map(initialData.contacts.map((saved) => [saved.id, saved]))
      const compassContacts = contactPayload().map((contact) => {
        const saved = contact.id && sagePersonIds.has(contact.id) ? savedById.get(contact.id) : undefined
        return saved ? {
          id: saved.id, name: saved.name, title: saved.title ?? "", email: saved.email ?? "",
          phone: saved.phone ?? "", isPrimary: saved.isPrimary,
        } : contact
      })
      const initialContacts = initialData.contacts.map((saved) => ({
        id: saved.id, name: saved.name, title: saved.title ?? "", email: saved.email ?? "",
        phone: saved.phone ?? "", isPrimary: saved.isPrimary,
      }))
      const compassChanged = category !== initialData.category ||
        JSON.stringify(compassContacts) !== JSON.stringify(initialContacts)
      if (compassChanged) {
        const saved = await updateVendor(initialData.id, { category, contacts: compassContacts })
        if (!saved.success) {
          toast.error(saved.error)
          return
        }
        if ("warning" in saved && saved.warning) toast.warning(saved.warning)
      }
      const result = await requestSageLinkedVendorChanges(initialData.id, {
        sage: sageDraft,
        contacts: contactPayload().filter((contact) => contact.id !== null && sagePersonIds.has(contact.id)),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.data.sage.length === 0) toast.success(compassChanged ? "Vendor updated" : "Nothing changed")
      const done = announceSageOutcomes(result.data.sage)
      await reloadSageState()
      onSageLinkedSaved?.()
      if (done) onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (sageLinked && initialData) {
      if (!sageDraft.name.trim()) return
      void saveSageLinked()
      return
    }
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      category,
      email: email.trim(),
      phone: phone.trim(),
      address: address.trim(),
      contacts: contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        title: contact.title,
        email: contact.email,
        phone: contact.phone,
        isPrimary: contact.isPrimary,
      })),
    })
  }

  function addContact(): void {
    setContacts((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        id: null,
        name: "",
        title: "",
        email: "",
        phone: "",
        isPrimary: current.length === 0 && !sageLinked,
      },
    ])
  }

  function updateContact(
    key: string,
    field: "name" | "title" | "email" | "phone",
    value: string
  ): void {
    setContacts((current) =>
      current.map((contact) =>
        contact.key === key ? { ...contact, [field]: value } : contact
      )
    )
  }

  function makePrimary(key: string): void {
    setContacts((current) =>
      current.map((contact) => ({
        ...contact,
        isPrimary: contact.key === key,
      }))
    )
  }

  function removeContact(key: string): void {
    setContacts((current) => {
      const removed = current.find((contact) => contact.key === key)
      const remaining = current.filter((contact) => contact.key !== key)
      if (!removed?.isPrimary || remaining.length === 0 || sageLinked) return remaining
      return remaining.map((contact, index) => ({
        ...contact,
        isPrimary: index === 0,
      }))
    })
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initialData ? "Edit Vendor" : "Add Vendor"}
    >
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <ResponsiveDialogBody>
          {initialData?.sageVendorNumber ? <SageNumberBadge number={initialData.sageVendorNumber} className="mb-3" /> : null}
          {sageLinked && initialData ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Linked to Sage. Every change shows in Compass when you save. Changes to name, owner, email,
                phone, address and Sage people also go to Sage for approval.
              </p>
              <SagePendingNotice kind="vendor_company" entityId={initialData.id} pending={sageState?.pending[initialData.id]}
                canEdit={!readOnly} onChanged={async () => { await reloadSageState(); onSageLinkedSaved?.() }} />
              {sageVerified ? <SageCompanyNameRow kind="vendor_company" entityId={initialData.id} onChanged={onSageLinkedSaved} /> : null}
              {companySaveNote ? <p className="text-xs text-muted-foreground">{companySaveNote}</p> : null}
              <div className="grid grid-cols-5 gap-3">
                <div className="col-span-3 space-y-1.5">
                  <Label htmlFor="vendor-name" className="text-xs">Company name *</Label>
                  <Input
                    id="vendor-name"
                    className="h-9"
                    value={sageDraft.name}
                    onChange={(e) => setSageDraft((current) => ({ ...current, name: e.target.value }))}
                    required
                    disabled={readOnly}
                  />
                  <SageFieldNote pending={sageState?.pending[initialData.id]} field="name" note={companyFieldNote("name")} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="vendor-category" className="text-xs">Vendor type *</Label>
                  <SearchableCombobox
                    id="vendor-category"
                    className="h-9"
                    value={category}
                    onValueChange={(value) => {
                      if (value !== "") setCategory(value)
                    }}
                    disabled={categoryLockedReason !== null}
                    options={categoryOptions}
                    ariaLabel="Vendor type"
                    placeholder="Choose vendor type"
                    searchPlaceholder="Search vendor types..."
                    emptyMessage="No matching vendor types. Add types in Settings › Vendor types."
                  />
                  {categoryLockedReason && !readOnly ? <p className="text-xs text-muted-foreground">{categoryLockedReason}</p> : null}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["email", "phone", ...SAGE_COMPANY_FIELDS] as const).map((field) => (
                  <div key={field} className="space-y-1.5">
                    <Label htmlFor={`vendor-sage-${field}`} className="text-xs">
                      {field === "email" ? "Company email" : field === "phone" ? "Company phone" : SAGE_FIELD_LABELS[field]}
                    </Label>
                    <Input
                      id={`vendor-sage-${field}`}
                      type={field === "email" || field === "primaryEmail" ? "email" : field === "phone" ? "tel" : "text"}
                      className="h-9"
                      value={sageDraft[field]}
                      onChange={(e) => {
                        const next = e.target.value
                        setSageDraft((current) => ({ ...current, [field]: next }))
                      }}
                      disabled={readOnly}
                    />
                    <SageFieldNote pending={sageState?.pending[initialData.id]} field={field} note={companyFieldNote(field)} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
            <div className="grid grid-cols-5 gap-3">
              <div className="col-span-3 space-y-1.5">
                <Label htmlFor="vendor-name" className="text-xs">
                  Company name *
                </Label>
                <Input
                  id="vendor-name"
                  className="h-9"
                  placeholder="Vendor company name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  disabled={locked}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="vendor-category" className="text-xs">
                  Vendor type *
                </Label>
                <SearchableCombobox
                  id="vendor-category"
                  className="h-9"
                  value={category}
                  onValueChange={(value) => {
                    if (value !== "") setCategory(value)
                  }}
                  disabled={locked}
                  options={categoryOptions}
                  ariaLabel="Vendor type"
                  placeholder="Choose vendor type"
                  searchPlaceholder="Search vendor types..."
                  emptyMessage="No matching vendor types. Add types in Settings › Vendor types."
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="vendor-email" className="text-xs">
                  Company email
                </Label>
                <Input
                  id="vendor-email"
                  type="email"
                  className="h-9"
                  placeholder="email@example.com"
                  value={email}
                  disabled={locked}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vendor-phone" className="text-xs">
                  Company phone
                </Label>
                <Input
                  id="vendor-phone"
                  className="h-9"
                  placeholder="(555) 123-4567"
                  value={phone}
                  disabled={locked}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-address" className="text-xs">
                Address
              </Label>
              <Input
                id="vendor-address"
                className="h-9"
                placeholder="Street, city, state"
                value={address}
                disabled={locked}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            </>
          )}
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>People at this company</Label>
                <p className="text-xs text-muted-foreground">
                  Add multiple contacts, each with their own email and phone.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addContact} disabled={readOnly}>
                <IconPlus className="size-4" />
                Add person
              </Button>
              {sageVerified && onSageCreateContact ? (
                <Button type="button" variant="outline" size="sm" onClick={onSageCreateContact}>Propose Sage person</Button>
              ) : null}
              {onMergePeople && initialData ? <Button type="button" variant="outline" size="sm" disabled={selectedPeopleIds.length !== 2} onClick={() => {
                const selected = initialData.contacts.filter((person) => selectedPeopleIds.includes(person.id))
                if (selected[0] && selected[1]) onMergePeople([selected[0], selected[1]])
              }}>Merge 2 people</Button> : null}
            </div>
            {contacts.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                No contact people have been added.
              </p>
            ) : (
              <div className="grid gap-3">
                {contacts.map((contact, index) => (
                  <div key={contact.key} className="grid gap-3 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      {onMergePeople && contact.id ? <Checkbox
                        aria-label={`Select ${contact.name} for duplicate merge`}
                        checked={selectedPeopleIds.includes(contact.id)}
                        onCheckedChange={(checked) => setSelectedPeopleIds((current) =>
                          checked === true ? [...current, contact.id ?? ""] : current.filter((id) => id !== contact.id))}
                      /> : null}
                      <p className="text-sm font-medium">
                        Contact {index + 1}
                        {sageLinked && !(contact.id && sagePersonIds.has(contact.id)) ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">Compass only, not in Sage</span>
                        ) : null}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={contact.isPrimary ? "secondary" : "ghost"}
                          onClick={() => makePrimary(contact.key)}
                          disabled={locked}
                        >
                          {contact.isPrimary ? "Primary" : "Make primary"}
                        </Button>
                        {contact.id && sageVerified && !initialData?.contacts.some((saved) => saved.id === contact.id && saved.sageContactId) && onSageLinkContact ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => onSageLinkContact(contact.id ?? "", contact.name, initialData?.contacts.find((saved) => saved.id === contact.id)?.sageLineNumber ?? null)}>
                            Verify Sage link
                          </Button>
                        ) : null}
                        {contact.id && onRequestSageAdd && !initialData?.contacts.some((saved) => saved.id === contact.id && saved.sageContactId) ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => onRequestSageAdd("vendor_person", contact.id ?? "")}>
                            Request add to Sage
                          </Button>
                        ) : null}
                        {contact.id && onLinkAccount ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => onLinkAccount(contact.id ?? "", contact.name, initialData?.contacts.find((saved) => saved.id === contact.id)?.userId ?? null)}>
                            Compass account
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeContact(contact.key)}
                          aria-label={`Remove contact ${index + 1}`}
                          disabled={readOnly || isSagePerson(contact)}
                        >
                          <IconTrash className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        required
                        disabled={readOnly}
                        value={contact.name}
                        onChange={(event) =>
                          updateContact(contact.key, "name", event.target.value)
                        }
                        placeholder="Contact name"
                      />
                      <Input
                        value={contact.title}
                        disabled={readOnly}
                        onChange={(event) =>
                          updateContact(contact.key, "title", event.target.value)
                        }
                        placeholder="Title"
                      />
                      <Input
                        type="email"
                        value={contact.email}
                        disabled={readOnly}
                        onChange={(event) =>
                          updateContact(contact.key, "email", event.target.value)
                        }
                        placeholder="Email"
                      />
                      <Input
                        type="tel"
                        value={contact.phone}
                        disabled={readOnly}
                        onChange={(event) =>
                          updateContact(contact.key, "phone", event.target.value)
                        }
                        placeholder="Phone"
                      />
                    </div>
                    {contact.id && isSagePerson(contact) ? (
                      <SagePersonNote
                        contactId={contact.id}
                        pending={sageState?.pending[contact.id]}
                        note={personSaveNote(contact)}
                        canEdit={!readOnly}
                        onChanged={async () => { await reloadSageState(); onSageLinkedSaved?.() }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-9"
          >
            Cancel
          </Button>
          {initialData && !sageVerified && onSageLinkCompany ? (
            <Button type="button" variant="outline" onClick={onSageLinkCompany}>Verify Sage link</Button>
          ) : null}
          {initialData && !sageLinked && onRequestSageAdd ? (
            <Button type="button" variant="outline" onClick={() => onRequestSageAdd("vendor_company", initialData.id)}>Request add to Sage</Button>
          ) : null}
          {sageLinked && !readOnly ? (
            <Button type="submit" className="h-9" disabled={saving}>Save</Button>
          ) : !readOnly ? (
            <Button type="submit" className="h-9">
              {initialData ? "Save Changes" : "Create Vendor"}
            </Button>
          ) : null}
        </ResponsiveDialogFooter>
      </form>
    </ResponsiveDialog>
  )
}

/** Under a Sage person: the pending Sage change, and what saving does on the Sage side. */
function SagePersonNote({
  contactId,
  pending,
  note,
  canEdit,
  onChanged,
}: {
  readonly contactId: string
  readonly pending: SagePendingChange | undefined
  readonly note: string | null
  readonly canEdit: boolean
  readonly onChanged: () => Promise<void>
}): React.ReactElement | null {
  if (pending) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <SagePendingMarker pending={pending} />
        <span className="text-xs text-muted-foreground">
          {pending.changes.map((change) => SAGE_FIELD_LABELS[change.field]).join(", ")}
        </span>
        {pending.error ? (
          <SagePendingNotice kind="vendor_person" entityId={contactId} pending={pending} canEdit={canEdit} onChanged={onChanged} />
        ) : null}
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </div>
    )
  }
  return <p className="text-xs text-muted-foreground">{note ?? "In Sage: changes show here at once and go to Sage for approval."}</p>
}
