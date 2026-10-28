"use client"

import * as React from "react"
import { toast } from "sonner"

import { importTradeDocs, scanTradeDocImport, type TradeDocImportScan } from "@/app/actions/vendor-trade-doc-import"
import { SearchableCombobox, type SearchableComboboxOption } from "@/components/searchable-combobox"
import { DriveItemField } from "@/components/google/drive-item-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ImportLayout, ImportProposal } from "@/lib/trade-docs/import-match"
import type { TradeDocType } from "@/lib/trade-docs/settings"

const DETECT = "detect"
const NONE = "none"
type Row = ImportProposal & { readonly docTypeChoice: string }
type Filter = "selected" | "attention" | "all"

/**
 * Bring existing trade docs in from a Drive folder: Compass reads the folder,
 * proposes a vendor, document and expiry for each file, and staff confirm
 * before anything is recorded. The files stay where they are in Drive.
 */
export function TradeDocImportDialog({
  open,
  onOpenChange,
  docTypes,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly docTypes: readonly TradeDocType[]
}): React.ReactElement {
  const [folder, setFolder] = React.useState("")
  const [layout, setLayout] = React.useState<ImportLayout>("file-names")
  const [defaultType, setDefaultType] = React.useState(DETECT)
  const [scan, setScan] = React.useState<TradeDocImportScan | null>(null)
  const [rows, setRows] = React.useState<readonly Row[]>([])
  const [filter, setFilter] = React.useState<Filter>("selected")
  const [pending, startTransition] = React.useTransition()
  const activeTypes = docTypes.filter((type) => type.active)

  React.useEffect(() => {
    if (open) return
    setScan(null)
    setRows([])
  }, [open])

  const vendorOptions = React.useMemo<readonly SearchableComboboxOption[]>(
    () => (scan?.vendors ?? []).map((vendor) => ({ value: vendor.id, label: vendor.name, description: vendor.category })),
    [scan],
  )

  function lookThrough(): void {
    startTransition(async () => {
      const result = await scanTradeDocImport({ folder, layout, defaultDocType: defaultType === DETECT ? null : defaultType })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setScan(result.data)
      setRows(result.data.proposals.map((proposal) => ({ ...proposal, docTypeChoice: proposal.docType ?? NONE })))
      setFilter("selected")
    })
  }

  function update(key: string, patch: Partial<Row>): void {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const ready = rows.filter((row) => row.selected && row.vendorId && row.docTypeChoice !== NONE)
  const visible = rows.filter((row) => (filter === "all" ? true : filter === "selected" ? row.selected : !row.selected || row.note !== null))

  function bringIn(): void {
    if (!scan) return
    startTransition(async () => {
      const result = await importTradeDocs({
        folder: scan.folder.id,
        items: ready.flatMap((row) =>
          row.vendorId
            ? [{ fileId: row.fileId, vendorId: row.vendorId, docType: row.docTypeChoice, kind: row.kind, expiresOn: row.expiresOn }]
            : [],
        ),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        `Brought in ${result.data.imported} document${result.data.imported === 1 ? "" : "s"}${result.data.skipped > 0 ? `; ${result.data.skipped} skipped` : ""}.`,
      )
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Bring in existing trade docs</DialogTitle>
          <DialogDescription>
            Compass reads a Drive folder and suggests the vendor, document and expiry date for each file. Check the list, then
            bring them in. Files stay where they are in Drive. Do one folder at a time.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr] md:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="trade-doc-import-folder">Drive folder</Label>
            <DriveItemField id="trade-doc-import-folder" choose="folder" ariaLabel="folder to bring in" browseTitle="Folder of existing trade docs" value={folder} onChange={(next) => setFolder(next)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="trade-doc-import-type">Documents in it</Label>
            <Select value={defaultType} onValueChange={setDefaultType}>
              <SelectTrigger id="trade-doc-import-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DETECT}>Tell from the file names</SelectItem>
                {activeTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" disabled={pending || !folder.trim()} onClick={lookThrough}>
            {pending && !scan ? "Looking…" : scan ? "Look again" : "Look through folder"}
          </Button>
        </div>
        <RadioGroup value={layout} onValueChange={(value) => { if (value === "file-names" || value === "vendor-folders") setLayout(value) }} className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="file-names" /> Vendor names are in the file names
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="vendor-folders" /> One folder per vendor
          </label>
        </RadioGroup>

        {scan && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p>
                <strong>{scan.folder.name}</strong>: {scan.fileCount} files, {ready.length} ready to bring in
                {scan.truncated ? ". The folder is very large; only part of it was read." : "."}
              </p>
              <div className="flex gap-1">
                {(["selected", "attention", "all"] as const).map((value) => (
                  <Button key={value} type="button" size="sm" variant={filter === value ? "secondary" : "ghost"} onClick={() => setFilter(value)}>
                    {value === "selected" ? "Ticked" : value === "attention" ? "Needs a look" : "Everything"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="w-10 px-3 py-2 font-medium"><span className="sr-only">Bring in</span></th>
                    <th className="px-3 py-2 font-medium">File</th>
                    <th className="px-3 py-2 font-medium">Vendor</th>
                    <th className="px-3 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Nothing here.</td></tr>
                  ) : visible.map((row) => {
                    const type = activeTypes.find((item) => item.id === row.docTypeChoice)
                    return (
                      <tr key={row.key} className="border-b align-top last:border-0">
                        <td className="px-3 py-2">
                          <Checkbox aria-label={`Bring in ${row.fileName}`} checked={row.selected} onCheckedChange={(checked) => update(row.key, { selected: checked === true })} />
                        </td>
                        <td className="max-w-xs px-3 py-2">
                          {row.webUrl ? (
                            <a href={row.webUrl} target="_blank" rel="noreferrer" className="break-words underline">{row.fileName}</a>
                          ) : (
                            <span className="break-words">{row.fileName}</span>
                          )}
                          {row.folderPath.length > 0 && <p className="text-xs text-muted-foreground">{row.folderPath.join(" / ")}</p>}
                          {row.note && <p className="text-xs text-warning">{row.note}</p>}
                        </td>
                        <td className="px-3 py-2">
                          <SearchableCombobox
                            options={vendorOptions}
                            value={row.vendorId ?? ""}
                            onValueChange={(value) => update(row.key, { vendorId: value || null, selected: Boolean(value) && row.docTypeChoice !== NONE })}
                            ariaLabel={`Vendor for ${row.fileName}`}
                            placeholder="Choose vendor"
                            searchPlaceholder="Search vendors"
                            className="w-60"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={row.docTypeChoice}
                            onValueChange={(value) => update(row.key, { docTypeChoice: value, kind: "document", selected: value !== NONE && Boolean(row.vendorId) })}
                          >
                            <SelectTrigger aria-label={`Document type for ${row.fileName}`} className="h-8 w-56">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Choose document</SelectItem>
                              {activeTypes.map((item) => (
                                <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {row.kind === "waiver" && type?.waiverLabel && <p className="mt-1 text-xs text-muted-foreground">Alternative: {type.waiverLabel}</p>}
                        </td>
                        <td className="px-3 py-2">
                          {type?.expires && row.kind !== "waiver" ? (
                            <Input
                              type="date"
                              aria-label={`Expiry date for ${row.fileName}`}
                              className="h-8 w-40"
                              value={row.expiresOn ?? ""}
                              onChange={(event) => update(row.key, { expiresOn: event.target.value || null })}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {scan && (
            <Button type="button" disabled={pending || ready.length === 0} onClick={bringIn}>
              {pending ? "Bringing in…" : `Bring in ${ready.length} document${ready.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
