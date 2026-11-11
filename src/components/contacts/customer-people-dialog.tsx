"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  deleteCustomerDirectoryPerson,
  getCustomerDirectoryPersonJobCount,
  getCustomerDirectoryPeople,
  saveCustomerDirectoryPerson,
  type CustomerDirectoryPerson,
  type CustomerPersonInput,
} from "@/app/actions/customer-people"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { RecordDrawer } from "@/components/record-drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { findExistingNamedPerson } from "@/lib/customer-person-match"
import { saveSageLinkedCustomerPerson } from "@/app/actions/sage-linked-edits"
import {
  announceSageOutcomes,
  SagePendingMarker,
  SagePendingNotice,
  sageSaveNote,
  useSageLinkedEditState,
} from "@/components/contacts/sage-linked-edit"
import { SAGE_FIELD_LABELS } from "@/lib/sage/sage-linked-edit-fields"
import { SageNumberBadge } from "@/components/sage-number-badge"
import { archivedPersonJobsNotice } from "@/lib/archived-person"

const EMPTY: CustomerPersonInput = { name: "", title: "", email: "", phone: "", isPrimary: false }

export function CustomerPeopleDialog({
  customer,
  onOpenChange,
  canEdit,
  canCreate,
  canDelete,
  canLinkAccounts,
  onSageLink,
  onSageCreate,
  onVerifySageCompany,
  onLinkAccount,
  onMergePeople,
  onRequestSageAdd,
}: {
  readonly customer: { readonly id: string; readonly name: string; readonly sageLinked: boolean; readonly sageVerified: boolean; readonly sageNumber: string | null } | null
  /** "Request add to Sage" for a person not in Sage. */
  readonly onRequestSageAdd?: (person: CustomerDirectoryPerson) => void
  readonly onOpenChange: (open: boolean) => void
  readonly canEdit: boolean
  readonly canCreate: boolean
  readonly canDelete: boolean
  readonly canLinkAccounts: boolean
  readonly onSageLink?: (person: CustomerDirectoryPerson) => void
  readonly onSageCreate?: () => void
  readonly onVerifySageCompany?: () => void
  readonly onLinkAccount: (person: CustomerDirectoryPerson) => void
  readonly onMergePeople?: (people: readonly [CustomerDirectoryPerson, CustomerDirectoryPerson]) => void
}): React.ReactElement {
  const [people, setPeople] = React.useState<readonly CustomerDirectoryPerson[]>([])
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<CustomerPersonInput>(EMPTY)
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(customer !== null)
  const [loadError, setLoadError] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<readonly string[]>([])

  const customerId = customer?.id
  const { state: sageState, reload: reloadSageState } = useSageLinkedEditState(
    "client_company", customer?.sageLinked ? customer.id : null, canEdit)
  const editingPerson = people.find((person) => person.id === editingId) ?? null
  const editingSagePerson = Boolean(editingPerson?.sageContactId)
  const reload = React.useCallback(async () => {
    if (!customerId) return
    setLoading(true)
    setLoadError(false)
    try { setPeople(await getCustomerDirectoryPeople(customerId)) }
    catch { setLoadError(true); toast.error("Could not load client contacts") }
    finally { setLoading(false) }
  }, [customerId])
  React.useEffect(() => { void reload() }, [reload])

  const edit = (person: CustomerDirectoryPerson) => {
    setEditingId(person.id)
    setDraft({ name: person.name, title: person.title ?? "", email: person.email ?? "", phone: person.phone ?? "", isPrimary: person.isPrimary })
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!customer) return
    const sameName = findExistingNamedPerson(people, draft.name, editingId)
    if (sameName) {
      toast.info(`${sameName.name} is already listed for this client.`)
      return
    }
    setBusy(true)
    try {
      // A Sage person's changes show in Compass at once and also become a
      // Sage change request.
      if (editingId && editingSagePerson) {
        const sageResult = await saveSageLinkedCustomerPerson(editingId, {
          name: draft.name, title: draft.title, email: draft.email, phone: draft.phone, isPrimary: draft.isPrimary,
        })
        if (!sageResult.success) {
          toast.error(sageResult.error)
          return
        }
        if (sageResult.data.sage.length === 0) {
          toast.success(draft.isPrimary !== editingPerson?.isPrimary ? "Client contact saved" : "Nothing changed")
        }
        const done = announceSageOutcomes(sageResult.data.sage)
        await Promise.all([reloadSageState(), reload()])
        if (done) {
          setEditingId(null)
          setDraft(EMPTY)
        }
        return
      }
      const result = await saveCustomerDirectoryPerson(customer.id, editingId, draft)
      if (!result.success) {
        toast.error(result.error)
        if (result.error.includes("already listed")) await reload()
        return
      }
      toast.success("Client contact saved")
      if (result.warning) toast.warning(result.warning)
      setEditingId(null)
      setDraft(EMPTY)
      await reload()
    } finally { setBusy(false) }
  }
  const remove = async (person: CustomerDirectoryPerson) => {
    setBusy(true)
    try {
      const count = await getCustomerDirectoryPersonJobCount(person.id)
      const jobs = archivedPersonJobsNotice(count.success ? count.jobCount : null)
      if (!window.confirm(`Remove ${person.name} from this client's contact list? ${jobs} Restoring them later does not put them back on jobs.`)) return
      const result = await deleteCustomerDirectoryPerson(person.id)
      if (!result.success) toast.error(result.error)
      else { toast.success("Client contact removed"); await reload() }
    } finally { setBusy(false) }
  }

  return (
    <RecordDrawer
      open={customer !== null}
      onOpenChange={onOpenChange}
      title={
        <>
          People at {customer?.name}
        </>
      }
      description="One client company can have multiple named people. Project contacts refer to these shared records."
    >
        <Button type="button" size="sm" variant="outline" className="w-fit" disabled={loading} onClick={() => void reload()}>Refresh people</Button>
        <div className="divide-y border-y">
          {loading ? <p className="py-4 text-sm text-muted-foreground">Loading people…</p> : null}
          {loadError ? <p className="py-4 text-sm text-destructive">Could not load people. Try Refresh people.</p> : null}
          {!loading && !loadError && people.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No people recorded for this client.</p> : null}
          {people.map((person) => (
            <div key={person.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              {onMergePeople ? <Checkbox
                aria-label={`Select ${person.name} for duplicate merge`}
                checked={selectedIds.includes(person.id)}
                onCheckedChange={(checked) => setSelectedIds((current) =>
                  checked === true ? [...current, person.id] : current.filter((id) => id !== person.id))}
              /> : null}
              <div>
                <div className="font-medium">
                  {person.name}{person.isPrimary ? " · Primary" : ""}
                  {customer?.sageLinked && !person.sageContactId ? <span className="ml-2 text-xs font-normal text-muted-foreground">Compass only, not in Sage</span> : null}
                </div>
                {person.sageContactId ? <SageNumberBadge number={customer?.sageNumber} className="my-1" /> : null}
                <div className="text-muted-foreground">{[person.title, person.email, person.phone].filter(Boolean).join(" · ")}</div>
                {sageState?.pending[person.id] ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <SagePendingMarker pending={sageState.pending[person.id]} />
                    <span className="text-xs text-muted-foreground">
                      {sageState.pending[person.id].changes.map((change) => SAGE_FIELD_LABELS[change.field]).join(", ")}
                    </span>
                    <SagePendingNotice kind="client_person" entityId={person.id} pending={sageState.pending[person.id]}
                      canEdit={canEdit} onChanged={async () => { await Promise.all([reloadSageState(), reload()]) }} />
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {!person.sageContactId && customer?.sageVerified && onSageLink ? <Button type="button" size="sm" variant="outline" onClick={() => onSageLink(person)}>Verify Sage link</Button> : null}
                {!person.sageContactId && onRequestSageAdd ? <Button type="button" size="sm" variant="outline" onClick={() => onRequestSageAdd(person)}>Request add to Sage</Button> : null}
                {canLinkAccounts ? <Button type="button" size="sm" variant="outline" onClick={() => onLinkAccount(person)}>Compass account</Button> : null}
                {canEdit
                  ? <Button type="button" size="sm" variant="outline" onClick={() => edit(person)}>Edit</Button> : null}
                {canDelete && !person.sageContactId && !person.userId ? <Button type="button" size="sm" variant="ghost" onClick={() => void remove(person)} disabled={busy}>Remove</Button> : null}
              </div>
            </div>
          ))}
        </div>
        {onMergePeople ? <Button type="button" size="sm" variant="outline" disabled={selectedIds.length !== 2 || busy} onClick={() => {
          const selected = people.filter((person) => selectedIds.includes(person.id))
          if (selected[0] && selected[1]) onMergePeople([selected[0], selected[1]])
        }}>Merge 2 people</Button> : null}
        {((editingId && canEdit) || (!editingId && canCreate)) ? (
          <form onSubmit={(event) => void save(event)} className="space-y-3">
            <p className="text-sm font-medium">{editingId ? "Edit person" : "Add person"}</p>
            {editingSagePerson && editingId ? <p className="text-xs text-muted-foreground">
              {sageSaveNote(sageState, editingId, { verified: customer?.sageVerified ?? false })
                ?? "In Sage: changes show in Compass when you save and also go to Sage for approval."}
            </p>
              : customer?.sageLinked ? <p className="text-xs text-muted-foreground">Saved in Compass only. Adding this person does not create or change a Sage contact.</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="customer-person-name">Name</Label><Input id="customer-person-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required /></div>
              <div className="space-y-1"><Label htmlFor="customer-person-title">Job title</Label><Input id="customer-person-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="customer-person-email">Email</Label><Input id="customer-person-email" type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="customer-person-phone">Phone</Label><Input id="customer-person-phone" value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.isPrimary} onCheckedChange={(checked) => setDraft((current) => ({ ...current, isPrimary: checked === true }))} />Primary contact</label>
            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
              {editingId ? <Button type="button" variant="outline" onClick={() => { setEditingId(null); setDraft(EMPTY) }}>Cancel edit</Button> : null}
              <Button type="submit" disabled={busy}>{editingId ? "Save person" : "Add person"}</Button>
            </div>
          </form>
        ) : customer?.sageLinked && !customer.sageVerified ? <div className="space-y-2 text-sm text-muted-foreground">
          <p>This client has a Sage number, but its exact Sage identity has not been verified. Look up the existing client link, then have an authorized reviewer approve it before proposing a new person.</p>
          {onVerifySageCompany ? <Button type="button" variant="outline" onClick={onVerifySageCompany}>Verify Sage client link</Button> : null}
        </div> : null}
        {customer?.sageVerified && canCreate && onSageCreate ? <Button type="button" variant="outline" onClick={onSageCreate}>Propose new Sage person</Button> : null}
    </RecordDrawer>
  )
}
