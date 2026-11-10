"use client"

import * as React from "react"
import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import {
  PAY_APPLICATION_OWNER_DETAILS,
  PAY_APPLICATION_OWNER_DETAIL_LABELS,
  isPayApplicationOwnerDetail
} from "@/lib/financials/pay-application-detail"

const GROUP = FEATURE_SETTINGS["pay-applications"]

/** Settings → Workflows: how much pay application detail clients see. */
export function PayApplicationSettingsSection(): React.ReactElement {
  const { loaded, canEdit, customized, error, pending, settings: value, setSettings: setValue, save: saveSettings, reset } = useFeatureSettingsEditor("pay-applications", {
    savedMessage: "Pay application settings saved.",
    resetMessage: "Pay application settings reset to defaults."
  })

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    saveSettings(value)
  }

  return (
    <section aria-labelledby="pay-application-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="pay-application-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pay-application-owner-detail">What the client sees</Label>
            <Select
              value={value.ownerDetail}
              disabled={pending || !canEdit}
              onValueChange={(next) => {
                if (isPayApplicationOwnerDetail(next)) setValue({ ownerDetail: next })
              }}
            >
              <SelectTrigger id="pay-application-owner-detail" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAY_APPLICATION_OWNER_DETAILS.map((detail) => (
                  <SelectItem key={detail} value={detail}>
                    {PAY_APPLICATION_OWNER_DETAIL_LABELS[detail]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Percent only shows each division's percent complete and the payment due, with no line amounts.
            </p>
          </div>
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
