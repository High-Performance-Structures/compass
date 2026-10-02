"use client"

import * as React from "react"
import { toast } from "sonner"

import { proposeSageContactCreate } from "@/app/actions/sage-contact-creates"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type SageContactCreateTarget = {
  readonly kind: "client_person" | "vendor_person"
  readonly companyId: string
  readonly companyName: string
}

const FIELD_LABELS = {
  name: "Name", title: "Job title", phone: "Phone", phoneExtension: "Extension",
  email: "Email", cellPhone: "Cell phone",
} as const
type Field = keyof typeof FIELD_LABELS
const FIELD_KEYS: readonly Field[] = ["name", "title", "phone", "phoneExtension", "email", "cellPhone"]

export function SageContactCreateDialog({ target, onOpenChange, onSubmitted }: {
  readonly target: SageContactCreateTarget | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmitted: () => void
}): React.ReactElement {
  const [fields, setFields] = React.useState<Record<Field, string>>({
    name: "", title: "", phone: "", phoneExtension: "", email: "", cellPhone: "",
  })
  const [busy, setBusy] = React.useState(false)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!target || busy) return
    setBusy(true)
    try {
      const result = await proposeSageContactCreate(target.kind, target.companyId, fields)
      if (!result.success) { toast.error(result.error); return }
      toast.success("New contact proposed for independent Sage review")
      onOpenChange(false)
      onSubmitted()
    } finally { setBusy(false) }
  }

  return <Dialog open={target !== null} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Propose new Sage contact</DialogTitle>
        <DialogDescription>
          Add a person at {target?.companyName}. Nothing is added to Sage or the shared directory until another authorized reviewer approves it and Sage confirms the new record.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELD_KEYS.map((field) => <div key={field} className="space-y-1">
            <Label htmlFor={`sage-create-${field}`}>{FIELD_LABELS[field]}</Label>
            <Input id={`sage-create-${field}`} required={field === "name"} type={field === "email" ? "email" : "text"}
              value={fields[field]} onChange={(event) => setFields((current) => ({ ...current, [field]: event.target.value }))} />
          </div>)}
        </div>
        <DialogFooter><Button type="submit" disabled={busy || !fields.name.trim()}>Submit for review</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
