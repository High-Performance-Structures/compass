"use client"

import * as React from "react"
import { IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import { saveFeatureSettings } from "@/app/actions/feature-settings"
import { applyVendorTypeMoves, getVendorTypeUsage, type VendorTypeUsage } from "@/app/actions/vendor-types"
import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import {
  VENDOR_JOB_ROLES,
  VENDOR_PAPERWORK_LEVELS,
  type VendorJobRole,
  type VendorPaperworkLevel,
  type VendorTypeSetting,
} from "@/lib/feature-settings/vendor-types-settings"

const KEY = "vendor-types"

const JOB_ROLE_LABELS: Readonly<Record<VendorJobRole, string>> = {
  subcontractor: "Subcontractor (performs work)",
  supplier: "Supplier (delivers material)",
  none: "No job role (never invited)",
}

const PAPERWORK_LABELS: Readonly<Record<VendorPaperworkLevel, string>> = {
  none: "Nothing",
  w9: "W-9 only",
  full: "Trade docs & insurance",
}

/** A row being edited: the type plus the name it was saved under, so a rename can carry over to its vendors. */
type Row = VendorTypeSetting & { readonly savedName: string | null }

/**
 * Settings › Company: vendor types (named as in Sage), each type's role on
 * jobs and the paperwork Compass requests. Saving carries renames over to
 * the vendors that have the type, and moves a removed type's vendors to the
 * type picked for them.
 */
export function VendorTypesSettingsSection(): React.ReactElement {
  const { canEdit, error, pending, settings, setSettings } = useFeatureSettingsEditor(KEY, {
    savedMessage: "Vendor types saved.",
    resetMessage: "Back to the defaults.",
  })
  const [rows, setRows] = React.useState<readonly Row[]>([])
  const [removed, setRemoved] = React.useState<readonly { readonly name: string; readonly moveTo: string }[]>([])
  const [usage, setUsage] = React.useState<VendorTypeUsage | null>(null)
  const [saving, startSaving] = React.useTransition()

  // Start editing from the saved list whenever it loads or reloads.
  React.useEffect(() => {
    setRows(settings.types.map((type) => ({ ...type, savedName: type.name })))
    setRemoved([])
  }, [settings])

  const loadUsage = React.useCallback(async () => {
    const result = await getVendorTypeUsage()
    if (result.success) setUsage(result.data)
  }, [])
  React.useEffect(() => {
    void loadUsage()
  }, [loadUsage])

  const disabled = pending || saving || !canEdit
  const vendorCount = (name: string | null): number => (name ? usage?.vendorCounts[name.trim().toLowerCase()] ?? 0 : 0)
  const listedNames = rows.map((row) => row.name.trim()).filter(Boolean)

  function update(index: number, patch: Partial<Row>): void {
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)))
  }

  function remove(index: number): void {
    const row = rows[index]
    if (!row) return
    if (row.savedName && vendorCount(row.savedName) > 0) setRemoved((current) => [...current, { name: row.savedName ?? "", moveTo: "" }])
    setRows((current) => current.filter((_, position) => position !== index))
  }

  // A type Sage already uses is a vendor Compass pays, so it starts at W-9 only.
  function addType(name = "", fromSage = false): void {
    setRows((current) => [...current, { name, jobRole: "none", paperwork: fromSage ? "w9" : "none", hidden: false, savedName: null }])
  }

  function save(): void {
    if (removed.some((type) => !type.moveTo)) {
      toast.error("Pick a type for the vendors of each removed type.")
      return
    }
    const types = rows.map(({ savedName: _savedName, ...type }) => ({ ...type, name: type.name.trim() }))
    const moves = [
      ...rows.flatMap((row) => (row.savedName && row.savedName !== row.name.trim() ? [{ from: row.savedName, to: row.name.trim() }] : [])),
      ...removed.map((type) => ({ from: type.name, to: type.moveTo })),
    ]
    startSaving(async () => {
      const saved = await saveVendorTypes(types)
      if (!saved) return
      if (moves.length > 0) {
        const result = await applyVendorTypeMoves({ moves })
        if (!result.success) {
          toast.error(`Types saved, but vendors weren't moved: ${result.error}`)
          return
        }
        if (result.moved > 0) toast.success(`${result.moved} vendor${result.moved === 1 ? "" : "s"} moved to their new type.`)
      }
      setSettings({ types })
      await loadUsage()
    })
  }

  return (
    <section aria-labelledby="vendor-types-settings" className="space-y-4 border-t pt-6">
      <div>
        <h2 id="vendor-types-settings" className="text-base font-semibold">{FEATURE_SETTINGS[KEY].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS[KEY].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Type name</th>
              <th className="px-3 py-2 font-medium">How it&apos;s treated on jobs</th>
              <th className="px-3 py-2 font-medium">Paperwork Compass requests</th>
              <th className="px-3 py-2 font-medium">Vendors</th>
              <th className="px-3 py-2 font-medium">Hide</th>
              <th className="px-3 py-2"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.savedName ?? "new"}-${index}`} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <Input aria-label="Vendor type name" value={row.name} maxLength={50} disabled={disabled} onChange={(event) => update(index, { name: event.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <Select value={row.jobRole} disabled={disabled} onValueChange={(value) => update(index, { jobRole: VENDOR_JOB_ROLES.find((role) => role === value) ?? "none" })}>
                    <SelectTrigger aria-label={`Job role for ${row.name || "this type"}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VENDOR_JOB_ROLES.map((role) => <SelectItem key={role} value={role}>{JOB_ROLE_LABELS[role]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <Select value={row.paperwork} disabled={disabled} onValueChange={(value) => update(index, { paperwork: VENDOR_PAPERWORK_LEVELS.find((level) => level === value) ?? "none" })}>
                    <SelectTrigger aria-label={`Paperwork for ${row.name || "this type"}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VENDOR_PAPERWORK_LEVELS.map((level) => <SelectItem key={level} value={level}>{PAPERWORK_LABELS[level]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{vendorCount(row.savedName)}</td>
                <td className="px-3 py-2">
                  <Checkbox aria-label={`Hide ${row.name || "this type"}`} checked={row.hidden} disabled={disabled} onCheckedChange={(checked) => update(index, { hidden: checked === true })} />
                </td>
                <td className="px-3 py-2">
                  <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${row.name || "this type"}`} disabled={disabled} onClick={() => remove(index)}>
                    <IconTrash className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {removed.length > 0 ? (
        <div className="grid gap-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Move vendors of removed types</p>
          {removed.map((type, index) => (
            <div key={type.name} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-center">
              <span className="text-sm">{type.name} · {vendorCount(type.name)} vendors move to</span>
              <Select
                value={type.moveTo}
                onValueChange={(value) => setRemoved((current) => current.map((item, position) => (position === index ? { ...item, moveTo: value } : item)))}
              >
                <SelectTrigger aria-label={`New type for ${type.name} vendors`}><SelectValue placeholder="Pick a type" /></SelectTrigger>
                <SelectContent>
                  {listedNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      ) : null}

      {usage && usage.sageTypesNotListed.length > 0 && canEdit ? (
        <div className="grid gap-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Types Sage uses that aren&apos;t on your list</p>
          {usage.sageTypesNotListed
            .filter((type) => !listedNames.some((name) => name.toLowerCase() === type.name.toLowerCase()))
            .map((type) => (
              <div key={type.name} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">{type.name} <span className="text-muted-foreground">· {type.count} in Sage</span></span>
                <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => addType(type.name, true)}>Add to list</Button>
              </div>
            ))}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Use the same names as Sage. Renaming a type renames it on every vendor that has it. Hidden types stay on the vendors that have them but aren&apos;t offered. Which documents each paperwork level asks for is set in Settings › Trade docs.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => addType()}>
              <IconPlus className="size-4" /> Add type
            </Button>
            <Button type="button" size="sm" disabled={disabled} onClick={save}>Save</Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
        )}
      </div>
    </section>
  )
}

/** Saves the list through the shared settings action; false (with a toast) when it was refused. */
async function saveVendorTypes(types: readonly VendorTypeSetting[]): Promise<boolean> {
  const result = await saveFeatureSettings(KEY, { types })
  if (!result.success) toast.error(result.error)
  else toast.success("Vendor types saved.")
  return result.success
}
