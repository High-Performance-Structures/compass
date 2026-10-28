"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  recordVendorTradeDoc,
  startVendorTradeDocUpload,
  updateVendorTradeDoc,
} from "@/app/actions/vendor-trade-docs"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { TradeDocType } from "@/lib/trade-docs/settings"
import type { TradeDocOnFile } from "@/lib/trade-docs/status"

export type TradeDocFormMode =
  | { readonly kind: "new"; readonly type: TradeDocType; readonly waiver: boolean }
  | { readonly kind: "edit"; readonly type: TradeDocType; readonly doc: TradeDocOnFile }

function uploadedFileId(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === "object" && parsed !== null && "id" in parsed && typeof parsed.id === "string") return parsed.id
  } catch {
    return null
  }
  return null
}

/**
 * Records a new document (uploaded to the vendor's Drive folder), the type's
 * accepted alternative, or corrects the dates and checks on one on file.
 */
export function TradeDocRecordForm({
  vendorId,
  mode,
  certificateChecks,
  onDone,
  onCancel,
}: {
  readonly vendorId: string
  readonly mode: TradeDocFormMode
  readonly certificateChecks: readonly string[]
  readonly onDone: () => void
  readonly onCancel: () => void
}): React.ReactElement {
  const existing = mode.kind === "edit" ? mode.doc : null
  const waiver = mode.kind === "new" ? mode.waiver : existing?.kind === "waiver"
  const [file, setFile] = React.useState<File | null>(null)
  const [effectiveOn, setEffectiveOn] = React.useState(existing?.effectiveOn ?? "")
  const [expiresOn, setExpiresOn] = React.useState(existing?.expiresOn ?? "")
  const [checks, setChecks] = React.useState<ReadonlySet<string>>(new Set(existing?.checks ?? []))
  const [notes, setNotes] = React.useState(existing?.notes ?? "")
  const [pending, startTransition] = React.useTransition()
  const showChecks = mode.type.certificateChecks && !waiver && certificateChecks.length > 0
  const idBase = `trade-doc-${mode.type.id}`

  function toggleCheck(check: string, on: boolean): void {
    setChecks((current) => {
      const next = new Set(current)
      if (on) next.add(check)
      else next.delete(check)
      return next
    })
  }

  function save(): void {
    startTransition(async () => {
      const shared = {
        effectiveOn: effectiveOn || null,
        expiresOn: expiresOn || null,
        checks: [...checks],
        notes: notes || null,
      }
      if (mode.kind === "edit") {
        const result = await updateVendorTradeDoc(mode.doc.id, shared)
        if (!result.success) {
          toast.error(result.error)
          return
        }
        toast.success("Saved.")
        onDone()
        return
      }
      if (!file && !waiver) {
        toast.error("Choose the file to upload.")
        return
      }
      let driveFileId: string | null = null
      if (file) {
        const session = await startVendorTradeDocUpload(vendorId, file.name, file.type)
        if (!session.success) {
          toast.error(session.error)
          return
        }
        const response = await fetch(session.data.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        })
        driveFileId = response.ok ? uploadedFileId(await response.text()) : null
        if (!driveFileId) {
          toast.error(`Upload failed for ${file.name}.`)
          return
        }
      }
      const result = await recordVendorTradeDoc(vendorId, {
        docType: mode.type.id,
        kind: waiver ? "waiver" : "document",
        driveFileId,
        ...shared,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${mode.type.label} recorded.`)
      onDone()
    })
  }

  return (
    <div className="grid gap-3 border-t bg-muted/30 px-3 py-3">
      <p className="text-sm font-medium">
        {mode.kind === "edit" ? `Edit ${mode.type.label}` : waiver ? `${mode.type.label}: ${mode.type.waiverLabel}` : `New ${mode.type.label}`}
      </p>
      {mode.kind === "new" && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${idBase}-file`}>{waiver ? "Signed forms (optional)" : "File"}</Label>
          <Input
            id={`${idBase}-file`}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">Saved to the vendor&apos;s trade docs folder in Google Drive.</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idBase}-effective`}>Effective date</Label>
          <Input id={`${idBase}-effective`} type="date" value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} />
        </div>
        {mode.type.expires && !waiver && (
          <div className="grid gap-1.5">
            <Label htmlFor={`${idBase}-expires`}>Expires</Label>
            <Input id={`${idBase}-expires`} type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />
          </div>
        )}
      </div>
      {showChecks && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Certificate check</legend>
          {certificateChecks.map((check) => (
            <label key={check} className="flex items-center gap-2 text-sm">
              <Checkbox checked={checks.has(check)} onCheckedChange={(value) => toggleCheck(check, value === true)} />
              {check}
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${idBase}-notes`}>Notes</Label>
        <Textarea id={`${idBase}-notes`} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          {pending ? "Saving…" : mode.kind === "edit" ? "Save" : file ? "Upload and save" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
