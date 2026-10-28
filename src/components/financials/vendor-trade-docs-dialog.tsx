"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  deleteVendorTradeDoc,
  getVendorTradeDocs,
  setVendorTradeDocBillMode,
  type VendorTradeDocsView,
} from "@/app/actions/vendor-trade-docs"
import { TradeDocRecordForm, type TradeDocFormMode } from "@/components/financials/trade-doc-record-form"
import { TradeDocRequestPanel } from "@/components/financials/trade-doc-request-panel"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  TRADE_DOC_BILL_MODES,
  TRADE_DOC_BILL_MODE_LABELS,
  isTradeDocBillMode,
} from "@/lib/trade-docs/settings"
import {
  TRADE_DOC_STATE_LABELS,
  tradeDocCountLabel,
  type TradeDocLine,
  type TradeDocOnFile,
  type TradeDocState,
} from "@/lib/trade-docs/status"
import { cn } from "@/lib/utils"

const STATE_CLASS: Readonly<Record<TradeDocState, string>> = {
  missing: "text-destructive",
  expired: "text-destructive",
  needs_date: "text-warning",
  expiring: "text-warning",
  on_file: "text-success",
  waived: "text-success",
}

function shortDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function lineDetail(line: TradeDocLine): string {
  const doc = line.doc
  if (!doc) return line.required ? "Not received yet" : ""
  const parts = [
    doc.kind === "waiver" ? line.type.waiverLabel : doc.fileName,
    line.daysLeft !== null
      ? line.daysLeft < 0
        ? `expired ${shortDate(doc.expiresOn)}`
        : `expires ${shortDate(doc.expiresOn)}${line.daysLeft <= 60 ? ` (${line.daysLeft} days)` : ""}`
      : null,
    `recorded ${shortDate(doc.createdAt)} by ${doc.createdByName}`,
  ]
  return parts.filter(Boolean).join(" · ")
}

const DEFAULT_BILL_MODE = "default"

/** A vendor's trade docs: what's required for its category, what's on file, and what's owed. */
export function VendorTradeDocsDialog({
  vendorId,
  vendorName,
  open,
  onOpenChange,
  onChanged,
}: {
  readonly vendorId: string
  readonly vendorName: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onChanged: () => void
}): React.ReactElement {
  const [view, setView] = React.useState<VendorTradeDocsView | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<TradeDocFormMode | null>(null)
  const [removing, setRemoving] = React.useState<TradeDocOnFile | null>(null)
  const [showHistory, setShowHistory] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getVendorTradeDocs(vendorId)
    if (result.success) {
      setView(result.data)
      setError(null)
    } else {
      setError(result.error)
    }
  }, [vendorId])

  React.useEffect(() => {
    if (!open) return
    setView(null)
    setForm(null)
    setShowHistory(false)
    void load()
  }, [open, load])

  function changed(): void {
    setForm(null)
    void load()
    onChanged()
  }

  function remove(doc: TradeDocOnFile): void {
    startTransition(async () => {
      const result = await deleteVendorTradeDoc(doc.id)
      setRemoving(null)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Removed. The file is still in Drive.")
      changed()
    })
  }

  function setBillMode(value: string): void {
    const mode = isTradeDocBillMode(value) ? value : null
    startTransition(async () => {
      const result = await setVendorTradeDocBillMode(vendorId, mode)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      changed()
    })
  }

  const summary = view?.summary
  const typeLabel = (docType: string): string => view?.summary.lines.find((line) => line.type.id === docType)?.type.label ?? docType

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Trade docs · {view?.vendor.name ?? vendorName}</DialogTitle>
          <DialogDescription>
            {view
              ? `${view.vendor.category}${summary ? ` · ${tradeDocCountLabel(summary)}` : ""}. Files are kept in the vendor's Drive folder.`
              : "What this vendor must have on file."}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !view || !summary ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-4">
            {summary.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is required from a {view.vendor.category.toLowerCase()}. Change what each kind of vendor needs in Settings → Workflows → Trade docs.
              </p>
            ) : (
              <div className="divide-y rounded-lg border">
                {summary.lines.map((line) => {
                  const formHere = form?.type.id === line.type.id
                  return (
                    <div key={line.type.id}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3">
                        <div className="min-w-0 flex-1 basis-60">
                          <p className="text-sm font-medium">
                            {line.type.label}
                            {!line.required && <span className="font-normal text-muted-foreground"> · extra</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {lineDetail(line)}
                            {line.doc?.webUrl && (
                              <>
                                {" · "}
                                <a href={line.doc.webUrl} target="_blank" rel="noreferrer" className="underline">
                                  Open
                                </a>
                              </>
                            )}
                          </p>
                          {line.doc && line.doc.checks.length > 0 && (
                            <p className="text-xs text-muted-foreground">Checked: {line.doc.checks.join(", ")}</p>
                          )}
                        </div>
                        <Badge variant="outline" className={cn(STATE_CLASS[line.state])}>
                          {TRADE_DOC_STATE_LABELS[line.state]}
                        </Badge>
                        {view.canEdit && !formHere && (
                          <div className="flex flex-wrap gap-1">
                            <Button type="button" size="sm" variant="outline" onClick={() => setForm({ kind: "new", type: line.type, waiver: false })}>
                              {line.doc ? "Upload new" : "Upload"}
                            </Button>
                            {line.type.waiverLabel && line.doc?.kind !== "waiver" && (
                              <Button type="button" size="sm" variant="outline" onClick={() => setForm({ kind: "new", type: line.type, waiver: true })}>
                                Alternative
                              </Button>
                            )}
                            {line.doc && (
                              <>
                                <Button type="button" size="sm" variant="ghost" onClick={() => line.doc && setForm({ kind: "edit", type: line.type, doc: line.doc })}>
                                  Edit
                                </Button>
                                <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setRemoving(line.doc)}>
                                  Remove
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      {formHere && form && (
                        <TradeDocRecordForm
                          vendorId={vendorId}
                          mode={form}
                          certificateChecks={view.certificateChecks}
                          onDone={changed}
                          onCancel={() => setForm(null)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="trade-doc-bill-mode">Bills while required docs are missing</Label>
                <Select
                  value={view.vendor.billMode ?? DEFAULT_BILL_MODE}
                  onValueChange={setBillMode}
                  disabled={!view.canEdit || pending}
                >
                  <SelectTrigger id="trade-doc-bill-mode" className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_BILL_MODE}>
                      Company default ({TRADE_DOC_BILL_MODE_LABELS[view.billModeDefault].toLowerCase()})
                    </SelectItem>
                    {TRADE_DOC_BILL_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {TRADE_DOC_BILL_MODE_LABELS[mode]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                {view.vendor.folderUrl && (
                  <a href={view.vendor.folderUrl} target="_blank" rel="noreferrer" className="underline">
                    Open Drive folder
                  </a>
                )}
                {view.history.length > 0 && (
                  <button type="button" className="underline" onClick={() => setShowHistory((current) => !current)}>
                    {showHistory ? "Hide" : "Show"} older documents ({view.history.length})
                  </button>
                )}
              </div>
            </div>

            <div className="border-t pt-4">
              <TradeDocRequestPanel vendorId={vendorId} canEdit={view.canEdit} onSent={() => void load()} />
            </div>

            {showHistory && (
              <ul className="grid gap-1 text-xs text-muted-foreground">
                {view.history.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {typeLabel(doc.docType)} · {doc.fileName ?? "alternative"} · recorded {shortDate(doc.createdAt)}
                      {doc.expiresOn ? ` · expired ${shortDate(doc.expiresOn)}` : ""}
                    </span>
                    {doc.webUrl && (
                      <a href={doc.webUrl} target="_blank" rel="noreferrer" className="underline">
                        Open
                      </a>
                    )}
                    {view.canEdit && (
                      <button type="button" className="text-destructive underline" onClick={() => setRemoving(doc)}>
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <AlertDialog open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this document?</AlertDialogTitle>
              <AlertDialogDescription>
                Compass stops counting {removing?.fileName ?? "it"} for {vendorName}. The file stays in Google Drive, and the
                removal is logged in Activity.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction disabled={pending} onClick={() => removing && remove(removing)}>
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
