"use client"

import * as React from "react"
import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { contractTypeLabel } from "@/lib/domain/estimates/variance-rules"
import { PROJECT_CONTRACT_TYPES, type ProjectContractType } from "@/lib/domain/project/statuses"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import {
  INSURANCE_RATE_SOURCES,
  type VarianceSettings
} from "@/lib/feature-settings/contract-settings"

const KEY = "variances"
const GROUP = FEATURE_SETTINGS[KEY]

const SOURCE_LABELS: Readonly<Record<VarianceSettings["insuranceRateSource"], string>> = {
  contract: "The job's own insurance line, as a share of the rest of its contract",
  fixed: "A fixed percent",
  off: "Don't add insurance"
}

function isContractType(value: string): value is ProjectContractType {
  return PROJECT_CONTRACT_TYPES.some((type) => type === value)
}

function isRateSource(value: string): value is VarianceSettings["insuranceRateSource"] {
  return INSURANCE_RATE_SOURCES.some((source) => source === value)
}

/** Settings → Workflows: default contract type and how liability insurance follows variances and change orders. */
export function VarianceSettingsSection(): React.ReactElement {
  const { loaded, canEdit, customized, error, pending, settings: value, setSettings: setValue, save: saveSettings, reset } = useFeatureSettingsEditor(KEY, {
    savedMessage: "Variance settings saved.",
    resetMessage: "Variance settings reset to defaults."
  })

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    saveSettings(value)
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="variance-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="variance-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="max-w-sm space-y-2">
            <Label htmlFor="variance-default-contract-type">Default contract type</Label>
            <Select
              value={value.defaultContractType}
              onValueChange={(next) => {
                if (isContractType(next)) setValue({ ...value, defaultContractType: next })
              }}
              disabled={disabled}
            >
              <SelectTrigger id="variance-default-contract-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_CONTRACT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>{contractTypeLabel(type)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Fixed price jobs have no variances. On cost plus the builder fee follows variances; on cost plus fixed fee it changes
              only with change orders. Each job can choose its own on its Information page.
            </p>
          </div>
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="variance-insurance-code">Liability insurance cost code</Label>
              <Input
                id="variance-insurance-code"
                value={value.insuranceCostCode}
                disabled={disabled}
                onChange={(event) => setValue({ ...value, insuranceCostCode: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="variance-insurance-name">Liability insurance name</Label>
              <Input
                id="variance-insurance-name"
                value={value.insuranceDescription}
                disabled={disabled}
                onChange={(event) => setValue({ ...value, insuranceDescription: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="variance-insurance-source">Insurance rate</Label>
              <Select
                value={value.insuranceRateSource}
                onValueChange={(next) => {
                  if (isRateSource(next)) setValue({ ...value, insuranceRateSource: next })
                }}
                disabled={disabled}
              >
                <SelectTrigger id="variance-insurance-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INSURANCE_RATE_SOURCES.map((source) => (
                    <SelectItem key={source} value={source}>{SOURCE_LABELS[source]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {value.insuranceRateSource === "fixed" ? (
              <div className="space-y-2">
                <Label htmlFor="variance-insurance-rate">Insurance percent</Label>
                <Input
                  id="variance-insurance-rate"
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={value.insuranceRatePercent}
                  disabled={disabled}
                  onChange={(event) => setValue({ ...value, insuranceRatePercent: Number(event.target.value) || 0 })}
                />
              </div>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            When a variance is approved, or a change order is executed from an estimate that didn&apos;t price insurance, Compass adds
            an insurance line at this rate on everything else in it. The line is matched to the job&apos;s insurance line by cost code or
            name.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <Button type="submit" size="sm" disabled={pending}>Save</Button>
                {customized ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to defaults</Button> : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
            )}
          </div>
        </form>
      ) : null}
    </section>
  )
}
