"use client"

import * as React from "react"
import { IconPlus, IconTrash } from "@tabler/icons-react"

import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { VENDOR_JOB_ROLES, type VendorJobRole } from "@/lib/feature-settings/vendor-types-settings"

const KEY = "vendor-types"

const JOB_ROLE_LABELS: Readonly<Record<VendorJobRole, string>> = {
  subcontractor: "Subcontractor (performs work)",
  supplier: "Supplier (delivers material)",
  none: "No job role (never invited)",
}

/** Settings › Company: vendor types (named as in Sage) and each one's role on jobs. */
export function VendorTypesSettingsSection(): React.ReactElement {
  const { canEdit, customized, error, pending, settings, setSettings, save, reset } = useFeatureSettingsEditor(KEY, {
    savedMessage: "Vendor types saved.",
    resetMessage: "Back to the defaults.",
  })
  const disabled = pending || !canEdit

  function update(index: number, patch: Partial<(typeof settings.types)[number]>): void {
    setSettings((current) => ({ types: current.types.map((type, position) => (position === index ? { ...type, ...patch } : type)) }))
  }

  return (
    <section aria-labelledby="vendor-types-settings" className="space-y-4 border-t pt-6">
      <div>
        <h2 id="vendor-types-settings" className="text-base font-semibold">{FEATURE_SETTINGS[KEY].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS[KEY].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          save(settings)
        }}
      >
        <ul className="grid gap-2">
          {settings.types.map((type, index) => (
            <li key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto_auto] sm:items-center">
              <Input
                aria-label="Vendor type name"
                value={type.name}
                maxLength={50}
                disabled={disabled}
                onChange={(event) => update(index, { name: event.target.value })}
              />
              <Select value={type.jobRole} disabled={disabled} onValueChange={(value) => update(index, { jobRole: VENDOR_JOB_ROLES.find((role) => role === value) ?? "none" })}>
                <SelectTrigger aria-label={`Job role for ${type.name || "this type"}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VENDOR_JOB_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>{JOB_ROLE_LABELS[role]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={type.hidden} disabled={disabled} onCheckedChange={(checked) => update(index, { hidden: checked === true })} />
                Hide
              </label>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove ${type.name || "this type"}`}
                disabled={disabled}
                onClick={() => setSettings((current) => ({ types: current.types.filter((_, position) => position !== index) }))}
              >
                <IconTrash className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Use the same names as Sage. Hidden types stay on the vendors that have them but aren&apos;t offered. A vendor whose type isn&apos;t listed keeps the older reading of its name until it&apos;s changed.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setSettings((current) => ({ types: [...current.types, { name: "", jobRole: "none", hidden: false }] }))}
              >
                <IconPlus className="size-4" /> Add type
              </Button>
              <Button type="submit" size="sm" disabled={pending}>Save</Button>
              {customized ? (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to defaults</Button>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
          )}
        </div>
      </form>
    </section>
  )
}
