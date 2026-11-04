"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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

export type PersonEditField<Key extends string> = {
  readonly key: Key
  readonly label: string
  readonly type?: "text" | "email" | "tel"
  readonly required?: boolean
  /** Why the field cannot be changed here, shown under it; the field is disabled. */
  readonly lockedReason?: string | null
}

export type PersonEditSaveResult =
  | { readonly success: true; readonly data: { readonly warning: string | null } }
  | { readonly success: false; readonly error: string }

/**
 * One person's contact information, edited in a small dialog. Used by the
 * Contacts tabs whose people had no edit form (Unassigned, Internal). The
 * caller's save action decides what may change; this only collects values.
 * Mount it per person (with a key) so it starts from that person's values.
 */
export function PersonEditDialog<Key extends string>({
  title,
  description,
  fields,
  initial,
  open,
  onOpenChange,
  onSave,
  onSaved,
}: {
  readonly title: string
  readonly description: string
  readonly fields: readonly PersonEditField<Key>[]
  readonly initial: Readonly<Record<Key, string>>
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSave: (values: Readonly<Record<Key, string>>) => Promise<PersonEditSaveResult>
  readonly onSaved: () => void
}): React.ReactElement {
  const [values, setValues] = React.useState<Readonly<Record<Key, string>>>(initial)
  const [busy, setBusy] = React.useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await onSave(values)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Contact information saved")
      if (result.data.warning) toast.warning(result.data.warning)
      onOpenChange(false)
      onSaved()
    } catch {
      toast.error("Could not save this person.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={`person-edit-${field.key}`}>{field.label}</Label>
                <Input
                  id={`person-edit-${field.key}`}
                  type={field.type ?? "text"}
                  required={field.required}
                  disabled={Boolean(field.lockedReason)}
                  value={values[field.key]}
                  onChange={(event) => {
                    const next = event.target.value
                    setValues((current) => ({ ...current, [field.key]: next }))
                  }}
                />
                {field.lockedReason ? <p className="text-xs text-muted-foreground">{field.lockedReason}</p> : null}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
