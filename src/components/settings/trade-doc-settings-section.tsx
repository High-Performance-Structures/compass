"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { TradeDocImportDialog } from "@/components/settings/trade-doc-import-dialog"
import {
  TRADE_DOC_BILL_MODES,
  TRADE_DOC_BILL_MODE_LABELS,
  driveFolderIdFromInput,
  isTradeDocBillMode,
  tradeDocSettingsSchema,
  type TradeDocBillMode,
  type TradeDocType,
} from "@/lib/trade-docs/settings"

/** Vendor categories offered as columns; any others already in use are added. */
const COMMON_CATEGORIES = ["Subcontractor", "Supplier", "Consultant"] as const

function newTypeId(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "document"
  let id = base
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`
  return id
}

/**
 * Settings → Workflows → Trade docs. Document types are turned off rather
 * than deleted so documents already recorded keep their type.
 */
export function TradeDocSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [types, setTypes] = React.useState<readonly TradeDocType[]>([])
  const [savedIds, setSavedIds] = React.useState<ReadonlySet<string>>(new Set())
  const [checks, setChecks] = React.useState("")
  const [folder, setFolder] = React.useState("")
  const [billMode, setBillMode] = React.useState<TradeDocBillMode>("flag")
  const [importOpen, setImportOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("trade-docs")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = tradeDocSettingsSchema.safeParse(result.data.settings)
    if (parsed.success) {
      setTypes(parsed.data.docTypes)
      setSavedIds(new Set(parsed.data.docTypes.map((type) => type.id)))
      setChecks(parsed.data.certificateChecks.join("\n"))
      setFolder(parsed.data.driveFolderId ?? "")
      setBillMode(parsed.data.billModeDefault)
    }
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const categories = React.useMemo(() => {
    const extra = types.flatMap((type) => type.requiredFor).filter((category) => !COMMON_CATEGORIES.some((common) => common.toLowerCase() === category.toLowerCase()))
    return [...COMMON_CATEGORIES, ...new Set(extra)]
  }, [types])

  function update(index: number, patch: Partial<TradeDocType>): void {
    setTypes((current) => current.map((type, i) => (i === index ? { ...type, ...patch } : type)))
  }

  function toggleCategory(index: number, category: string, on: boolean): void {
    const type = types[index]
    if (!type) return
    const rest = type.requiredFor.filter((item) => item.toLowerCase() !== category.toLowerCase())
    update(index, { requiredFor: on ? [...rest, category] : rest })
  }

  function addType(): void {
    setTypes((current) => [
      ...current,
      {
        id: newTypeId("New document", new Set(current.map((type) => type.id))),
        label: "New document",
        requiredFor: ["Subcontractor"],
        expires: false,
        remindDaysBefore: 30,
        waiverLabel: null,
        certificateChecks: false,
        active: true,
      },
    ])
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const taken = new Set(savedIds)
    const prepared = types.map((type) => {
      if (savedIds.has(type.id)) return type
      const id = newTypeId(type.label, taken)
      taken.add(id)
      return { ...type, id }
    })
    const folderId = driveFolderIdFromInput(folder)
    if (folder.trim() && !folderId) {
      toast.error("Paste the Drive folder's link or id.")
      return
    }
    const parsed = tradeDocSettingsSchema.safeParse({
      docTypes: prepared,
      certificateChecks: checks.split("\n").map((line) => line.trim()).filter(Boolean),
      driveFolderId: folderId,
      billModeDefault: billMode,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the documents and try again.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("trade-docs", parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Trade docs saved")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("trade-docs")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Trade docs reset")
      await load()
    })
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!loaded) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <form onSubmit={save} className="grid gap-5">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Required documents</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          What each kind of vendor must have on file. A vendor&apos;s kind is its category in the directory. Documents that
          expire are flagged this many days ahead. Turn a document off instead of removing it, so ones already recorded
          keep their type.
        </p>
      </div>
      <fieldset className="grid gap-2" disabled={!canEdit || pending}>
        <legend className="sr-only">Required documents</legend>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Document</th>
                {categories.map((category) => (
                  <th key={category} className="py-2 pr-4 font-medium">{category}</th>
                ))}
                <th className="py-2 pr-4 font-medium">Expires</th>
                <th className="py-2 pr-4 font-medium">Warn days before</th>
                <th className="py-2 pr-4 font-medium">Certificate check</th>
                <th className="py-2 pr-4 font-medium">Accepted alternative</th>
                <th className="py-2 font-medium">On</th>
              </tr>
            </thead>
            <tbody>
              {types.map((type, index) => (
                <tr key={type.id} className="border-b align-top">
                  <td className="py-2 pr-4">
                    <Input aria-label={`Name of document ${index + 1}`} className="h-8 w-52" value={type.label} maxLength={60} onChange={(event) => update(index, { label: event.target.value })} />
                  </td>
                  {categories.map((category) => (
                    <td key={category} className="py-2 pr-4">
                      <Checkbox
                        aria-label={`${category} must have ${type.label}`}
                        checked={type.requiredFor.some((item) => item.toLowerCase() === category.toLowerCase())}
                        onCheckedChange={(checked) => toggleCategory(index, category, checked === true)}
                      />
                    </td>
                  ))}
                  <td className="py-2 pr-4">
                    <Checkbox aria-label={`${type.label} expires`} checked={type.expires} onCheckedChange={(checked) => update(index, { expires: checked === true })} />
                  </td>
                  <td className="py-2 pr-4">
                    <Input
                      aria-label={`Days before ${type.label} expires to warn`}
                      type="number"
                      min={0}
                      max={180}
                      inputMode="numeric"
                      className="h-8 w-20"
                      disabled={!type.expires}
                      value={String(type.remindDaysBefore)}
                      onChange={(event) => update(index, { remindDaysBefore: Math.max(0, Math.min(180, Number(event.target.value) || 0)) })}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <Checkbox aria-label={`Show the certificate check for ${type.label}`} checked={type.certificateChecks} onCheckedChange={(checked) => update(index, { certificateChecks: checked === true })} />
                  </td>
                  <td className="py-2 pr-4">
                    <Input
                      aria-label={`Accepted alternative to ${type.label}`}
                      className="h-8 w-56"
                      placeholder="None"
                      maxLength={160}
                      value={type.waiverLabel ?? ""}
                      onChange={(event) => update(index, { waiverLabel: event.target.value.trim() ? event.target.value : null })}
                    />
                  </td>
                  <td className="py-2">
                    <Switch aria-label={`Require ${type.label}`} checked={type.active} onCheckedChange={(active) => update(index, { active })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={addType} disabled={types.length >= 30}>
            Add document
          </Button>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:max-w-2xl" disabled={!canEdit || pending}>
        <legend className="sr-only">Certificates, Drive and bills</legend>
        <div className="grid gap-1.5">
          <Label htmlFor="trade-doc-checks">Certificate check</Label>
          <Textarea id="trade-doc-checks" rows={5} value={checks} onChange={(event) => setChecks(event.target.value)} />
          <p className="text-xs text-muted-foreground">One per line. Staff tick these when they record an insurance certificate.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="trade-doc-folder">Drive folder for trade docs</Label>
          <Input id="trade-doc-folder" placeholder="Paste the folder's link" value={folder} onChange={(event) => setFolder(event.target.value)} />
          <p className="text-xs text-muted-foreground">
            Compass keeps one folder per vendor inside it, reusing a folder that already has the vendor&apos;s name. Blank uses the
            company&apos;s Drive.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="trade-doc-bill-mode-default">Bills while required docs are missing</Label>
          <Select value={billMode} onValueChange={(value) => { if (isTradeDocBillMode(value)) setBillMode(value) }}>
            <SelectTrigger id="trade-doc-bill-mode-default" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRADE_DOC_BILL_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>{TRADE_DOC_BILL_MODE_LABELS[mode]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">The default for every vendor. Change it for one vendor in its trade docs.</p>
        </div>
      </fieldset>

      <div className="grid gap-2 border-t pt-4 sm:max-w-2xl">
        <h3 className="text-sm font-semibold">Documents you already have</h3>
        <p className="text-sm text-muted-foreground">
          Bring in W-9s, certificates, licenses and signed agreements already kept in Drive. Compass suggests the vendor and
          expiry date from each file&apos;s folder or name, and you check the list first.
        </p>
        <div>
          <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>Bring in from Drive</Button>
        </div>
        <TradeDocImportDialog open={importOpen} onOpenChange={setImportOpen} docTypes={types.filter((type) => savedIds.has(type.id))} />
      </div>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>Save</Button>
          {customized ? (
            <Button type="button" variant="outline" disabled={pending} onClick={reset}>Reset to defaults</Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only admins can change these settings.</p>
      )}
    </form>
  )
}
