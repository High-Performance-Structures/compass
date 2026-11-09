"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Customer } from "@/db/schema"
import type { CustomerRelationshipType } from "@/app/actions/customers"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { toast } from "sonner"
import { requestSageLinkedCustomerChanges } from "@/app/actions/sage-linked-edits"
import { updateCustomer } from "@/app/actions/customers"
import { SageCompanyNameRow } from "@/components/contacts/sage-contact-editor-dialog"
import { SageNumberBadge } from "@/components/sage-number-badge"
import {
  announceSageOutcomes,
  SageFieldNote,
  sageFieldNote,
  SagePendingNotice,
  sageSaveNote,
  useSageLinkedEditState,
} from "@/components/contacts/sage-linked-edit"
import { SAGE_FIELD_LABELS } from "@/lib/sage/sage-linked-edit-fields"

/** Client fields shared with Sage, edited inline on a Sage-linked client. */
const SAGE_CLIENT_FIELDS = [
  "name", "email", "phone",
  "addressLine1", "addressLine2", "city", "state", "postalCode",
  "billingAddressLine1", "billingAddressLine2", "billingCity", "billingState", "billingPostalCode",
] as const
type SageClientField = (typeof SAGE_CLIENT_FIELDS)[number]
type SageClientDraft = Readonly<Record<SageClientField, string>>

function sageClientDraft(customer: Customer | null | undefined): SageClientDraft {
  return {
    name: customer?.name ?? "", email: customer?.email ?? "", phone: customer?.phone ?? "",
    addressLine1: customer?.addressLine1 ?? "", addressLine2: customer?.addressLine2 ?? "",
    city: customer?.city ?? "", state: customer?.state ?? "", postalCode: customer?.postalCode ?? "",
    billingAddressLine1: customer?.billingAddressLine1 ?? "", billingAddressLine2: customer?.billingAddressLine2 ?? "",
    billingCity: customer?.billingCity ?? "", billingState: customer?.billingState ?? "",
    billingPostalCode: customer?.billingPostalCode ?? "",
  }
}

/** Sage's client primary email screen binding is unverified, so it is Compass's own for now. */
const CLIENT_PRIMARY_EMAIL_NOTE = "Saved in Compass only; Compass cannot send the client's primary email to Sage yet."

interface CustomerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: Customer | null
  onSubmit: (data: {
    name: string
    company: string
    email: string
    phone: string
    address: string
    notes: string
    relationshipType: CustomerRelationshipType
  }) => void
  onManagePeople?: () => void
  onSageLinkCompany?: () => void
  /** After a Sage-linked client saves inline: refresh the directory. */
  onSageLinkedSaved?: () => void
  /** "Request add to Sage" for a client not in Sage. */
  onRequestSageAdd?: () => void
  canEdit?: boolean
}

export function CustomerDialog({
  open,
  onOpenChange,
  initialData,
  onSubmit,
  onManagePeople,
  onSageLinkCompany,
  onSageLinkedSaved,
  onRequestSageAdd,
  canEdit = true,
}: CustomerDialogProps) {
  const { developerModeEnabled } = useDeveloperMode()
  const [name, setName] = React.useState("")
  const [company, setCompany] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [address, setAddress] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [relationshipType, setRelationshipType] =
    React.useState<CustomerRelationshipType>("client")
  const sageLinked = Boolean(initialData?.sageClientId || initialData?.sageClientNumber)
  const sageVerified = Boolean(initialData?.sageClientId)
  const [sageDraft, setSageDraft] = React.useState<SageClientDraft>(() => sageClientDraft(initialData))
  const [primaryEmail, setPrimaryEmail] = React.useState(initialData?.primaryEmail ?? "")
  const [saving, setSaving] = React.useState(false)
  const { state: sageState, reload: reloadSageState } = useSageLinkedEditState(
    "client_company", sageLinked && open && initialData ? initialData.id : null, canEdit)
  // Every field always saves in Compass; the notes only say what Sage does with it.
  const fieldNote = (field: SageClientField): string | null => canEdit ? sageFieldNote(sageState, field) : null
  const saveNote = canEdit && initialData ? sageSaveNote(sageState, initialData.id, { verified: sageVerified }) : null

  React.useEffect(() => {
    setSageDraft(sageClientDraft(initialData))
    setPrimaryEmail(initialData?.primaryEmail ?? "")
    if (initialData) {
      setName(initialData.name)
      setCompany(initialData.company ?? "")
      setEmail(initialData.email ?? "")
      setPhone(initialData.phone ?? "")
      setAddress(initialData.address ?? "")
      setNotes(initialData.notes ?? "")
      setRelationshipType(
        initialData.sageClientId || initialData.sageClientNumber
          ? "client"
          : initialData.relationshipType === "lead"
            ? "lead"
            : "client"
      )
    } else {
      setName("")
      setCompany("")
      setEmail("")
      setPhone("")
      setAddress("")
      setNotes("")
      setRelationshipType("client")
    }
  }, [initialData, open])

  const saveSageLinked = async () => {
    if (!initialData) return
    setSaving(true)
    try {
      // Company, notes and primary email are Compass's own; the rest also go to Sage.
      const compassChanged = company.trim() !== (initialData.company ?? "").trim() ||
        notes.trim() !== (initialData.notes ?? "").trim() ||
        primaryEmail.trim() !== (initialData.primaryEmail ?? "").trim()
      if (compassChanged) {
        const saved = await updateCustomer(initialData.id, {
          company: company.trim() || null, notes: notes.trim() || null, primaryEmail: primaryEmail.trim() || null,
        })
        if (!saved.success) {
          toast.error(saved.error ?? "Could not save client")
          return
        }
      }
      const result = await requestSageLinkedCustomerChanges(initialData.id, { sage: sageDraft })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.data.sage.length === 0) toast.success(compassChanged ? "Client updated" : "Nothing changed")
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
      company: company.trim(),
      email: email.trim(),
      phone: phone.trim(),
      address: address.trim(),
      notes: notes.trim(),
      relationshipType,
    })
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initialData ? "Edit Client / Lead" : "Add Client / Lead"}
      description={
        sageLinked
          ? "Linked to Sage. Every change shows in Compass when you save. Changes to name, email, phone and addresses also go to Sage for approval."
          : developerModeEnabled
          ? "Maintain the directory record without granting project access or creating a Sage client. Add individual people separately."
          : "Maintain the directory record without granting project access. Add individual people separately."
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <ResponsiveDialogBody>
          {initialData?.sageClientNumber ? <SageNumberBadge number={initialData.sageClientNumber} className="mb-3" /> : null}
          {sageLinked && initialData ? (
            <div className="space-y-3">
              <SagePendingNotice kind="client_company" entityId={initialData.id} pending={sageState?.pending[initialData.id]}
                canEdit={canEdit} onChanged={async () => { await reloadSageState(); onSageLinkedSaved?.() }} />
              {sageVerified ? <SageCompanyNameRow kind="client_company" entityId={initialData.id} onChanged={onSageLinkedSaved} /> : null}
              {saveNote ? <p className="text-xs text-muted-foreground">{saveNote}</p> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {SAGE_CLIENT_FIELDS.map((field) => (
                  <div key={field} className={field === "name" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                    <Label htmlFor={`cust-sage-${field}`} className="text-xs">
                      {field === "name" ? "Client name *" : SAGE_FIELD_LABELS[field]}
                    </Label>
                    <Input
                      id={`cust-sage-${field}`}
                      type={field === "email" ? "email" : field === "phone" ? "tel" : "text"}
                      className="h-9"
                      value={sageDraft[field]}
                      required={field === "name"}
                      onChange={(e) => {
                        const next = e.target.value
                        setSageDraft((current) => ({ ...current, [field]: next }))
                      }}
                      disabled={!canEdit}
                    />
                    <SageFieldNote pending={sageState?.pending[initialData.id]} field={field} note={fieldNote(field)} />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <Label htmlFor="cust-primary-email" className="text-xs">Primary email</Label>
                  <Input id="cust-primary-email" type="email" className="h-9" value={primaryEmail} disabled={!canEdit}
                    onChange={(e) => setPrimaryEmail(e.target.value)} />
                  <p className="text-xs text-muted-foreground">{CLIENT_PRIMARY_EMAIL_NOTE}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-company" className="text-xs">Company</Label>
                <Input
                  id="cust-company"
                  className="h-9"
                  placeholder="Company or organization"
                  value={company}
                  disabled={!canEdit}
                  onChange={(e) => setCompany(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Compass only; Sage has no separate company field.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-notes" className="text-xs">Notes</Label>
                <Textarea
                  id="cust-notes"
                  value={notes}
                  disabled={!canEdit}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Additional notes..."
                  className="text-sm resize-none"
                />
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="cust-name" className="text-xs">
                  Directory display name *
                </Label>
                <Input
                  id="cust-name"
                  className="h-9"
                  placeholder="Client or lead name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-relationship" className="text-xs">
                  Contact status
                </Label>
                <Select
                  value={relationshipType}
                  onValueChange={(value) => {
                    if (value === "client" || value === "lead") {
                      setRelationshipType(value)
                    }
                  }}
                  disabled={Boolean(
                    initialData?.sageClientId || initialData?.sageClientNumber
                  )}
                >
                  <SelectTrigger id="cust-relationship" className="h-9">
                    <SelectValue placeholder="Client or lead" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="lead">Lead</SelectItem>
                  </SelectContent>
                </Select>
                {(initialData?.sageClientId || initialData?.sageClientNumber) && (
                  <p className="text-xs text-muted-foreground">
                    {developerModeEnabled
                      ? "Sage-linked directory records remain clients."
                      : "Linked directory records remain clients."}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-company" className="text-xs">
                  Company
                </Label>
                <Input
                  id="cust-company"
                  className="h-9"
                  placeholder="Company or organization"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cust-email" className="text-xs">
                    Email
                  </Label>
                  <Input
                    id="cust-email"
                    type="email"
                    className="h-9"
                    placeholder="email@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cust-phone" className="text-xs">
                    Phone
                  </Label>
                  <Input
                    id="cust-phone"
                    className="h-9"
                    placeholder="(555) 123-4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-address" className="text-xs">
                  Address
                </Label>
                <Input
                  id="cust-address"
                  className="h-9"
                  placeholder="Street, city, state"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-notes" className="text-xs">
                  Notes
                </Label>
                <Textarea
                  id="cust-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Additional notes..."
                  className="text-sm resize-none"
                />
              </div>
            </>
          )}
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
          {initialData && onManagePeople ? (
            <Button type="button" variant="outline" onClick={onManagePeople}>People at this client</Button>
          ) : null}
          {initialData && !sageVerified && onSageLinkCompany ? (
            <Button type="button" variant="outline" onClick={onSageLinkCompany}>Verify Sage link</Button>
          ) : null}
          {initialData && !sageLinked && onRequestSageAdd ? (
            <Button type="button" variant="outline" onClick={onRequestSageAdd}>Request add to Sage</Button>
          ) : null}
          {sageLinked ? (
            canEdit ? <Button type="submit" className="h-9" disabled={saving}>Save</Button> : null
          ) : (
            <Button type="submit" className="h-9">
              {initialData ? "Save Changes" : "Add to Contacts"}
            </Button>
          )}
        </ResponsiveDialogFooter>
      </form>
    </ResponsiveDialog>
  )
}
