"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  deleteCustomerDirectoryPerson,
  getCustomerDirectoryPeople,
  saveCustomerDirectoryPerson,
  type CustomerDirectoryPerson,
  type CustomerPersonInput,
} from "@/app/actions/customer-people"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const EMPTY: CustomerPersonInput = { name: "", title: "", email: "", phone: "", isPrimary: false }

export function CustomerPeopleDialog({
  customer,
  onOpenChange,
  canEdit,
  canDelete,
  canLinkAccounts,
  onSageEdit,
  onSageLink,
  onLinkAccount,
}: {
  readonly customer: { readonly id: string; readonly name: string; readonly sageLinked: boolean; readonly sageVerified: boolean } | null
  readonly onOpenChange: (open: boolean) => void
  readonly canEdit: boolean
  readonly canDelete: boolean
  readonly canLinkAccounts: boolean
  readonly onSageEdit: (person: CustomerDirectoryPerson) => void
  readonly onSageLink?: (person: CustomerDirectoryPerson) => void
  readonly onLinkAccount: (person: CustomerDirectoryPerson) => void
}): React.ReactElement {
  const [people, setPeople] = React.useState<readonly CustomerDirectoryPerson[]>([])
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<CustomerPersonInput>(EMPTY)
  const [busy, setBusy] = React.useState(false)

  const reload = React.useCallback(async () => {
    if (!customer) return
    try { setPeople(await getCustomerDirectoryPeople(customer.id)) }
    catch { toast.error("Could not load client contacts") }
  }, [customer])
  React.useEffect(() => { void reload() }, [reload])

  const edit = (person: CustomerDirectoryPerson) => {
    setEditingId(person.id)
    setDraft({ name: person.name, title: person.title ?? "", email: person.email ?? "", phone: person.phone ?? "", isPrimary: person.isPrimary })
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!customer) return
    setBusy(true)
    try {
      const result = await saveCustomerDirectoryPerson(customer.id, editingId, draft)
      if (!result.success) { toast.error(result.error); return }
      toast.success("Client contact saved")
      setEditingId(null)
      setDraft(EMPTY)
      await reload()
    } finally { setBusy(false) }
  }
  const remove = async (person: CustomerDirectoryPerson) => {
    if (!window.confirm(`Remove ${person.name} from this client's contact list?`)) return
    setBusy(true)
    try {
      const result = await deleteCustomerDirectoryPerson(person.id)
      if (!result.success) toast.error(result.error)
      else { toast.success("Client contact removed"); await reload() }
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={customer !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>People at {customer?.name}</DialogTitle>
          <DialogDescription>One client company can have multiple named people. Project contacts refer to these shared records.</DialogDescription>
        </DialogHeader>
        <div className="divide-y border-y">
          {people.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No people recorded for this client.</p> : null}
          {people.map((person) => (
            <div key={person.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div>
                <div className="font-medium">{person.name}{person.isPrimary ? " · Primary" : ""}</div>
                <div className="text-muted-foreground">{[person.title, person.email, person.phone].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {person.sageContactId && canEdit ? <Button type="button" size="sm" variant="outline" onClick={() => onSageEdit(person)}>Propose Sage edit</Button> : null}
                {!person.sageContactId && customer?.sageVerified && onSageLink ? <Button type="button" size="sm" variant="outline" onClick={() => onSageLink(person)}>Verify Sage link</Button> : null}
                {canLinkAccounts ? <Button type="button" size="sm" variant="outline" onClick={() => onLinkAccount(person)}>Compass account</Button> : null}
                {canEdit && !customer?.sageLinked ? <Button type="button" size="sm" variant="outline" onClick={() => edit(person)}>Edit</Button> : null}
                {canDelete && !customer?.sageLinked ? <Button type="button" size="sm" variant="ghost" onClick={() => void remove(person)} disabled={busy}>Remove</Button> : null}
              </div>
            </div>
          ))}
        </div>
        {canEdit && !customer?.sageLinked ? (
          <form onSubmit={(event) => void save(event)} className="space-y-3">
            <p className="text-sm font-medium">{editingId ? "Edit person" : "Add person"}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="customer-person-name">Name</Label><Input id="customer-person-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required /></div>
              <div className="space-y-1"><Label htmlFor="customer-person-title">Job title</Label><Input id="customer-person-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="customer-person-email">Email</Label><Input id="customer-person-email" type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="customer-person-phone">Phone</Label><Input id="customer-person-phone" value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.isPrimary} onCheckedChange={(checked) => setDraft((current) => ({ ...current, isPrimary: checked === true }))} />Primary contact</label>
            <DialogFooter>
              {editingId ? <Button type="button" variant="outline" onClick={() => { setEditingId(null); setDraft(EMPTY) }}>Cancel edit</Button> : null}
              <Button type="submit" disabled={busy}>{editingId ? "Save person" : "Add person"}</Button>
            </DialogFooter>
          </form>
        ) : customer?.sageLinked ? <p className="text-sm text-muted-foreground">New people for Sage-linked clients or unverified Sage candidates require a reviewed Sage link and contact workflow.</p> : null}
      </DialogContent>
    </Dialog>
  )
}
