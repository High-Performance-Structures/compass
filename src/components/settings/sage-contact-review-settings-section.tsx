"use client"

import * as React from "react"
import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["sage-contact-review"]

/** Settings → Workflows: whether the requester may approve their own Sage contact changes. */
export function SageContactReviewSettingsSection(): React.ReactElement {
  const { loaded, canEdit, customized, error, pending, settings: value, setSettings: setValue, save: saveSettings, reset } = useFeatureSettingsEditor("sage-contact-review", {
    savedMessage: "Sage contact review settings saved.",
    resetMessage: "Sage contact review settings reset to defaults."
  })

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    saveSettings(value)
  }

  return (
    <section aria-labelledby="sage-contact-review-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="sage-contact-review-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="sage-contact-review-second-approver">Require a second person to approve Sage contact changes</Label>
              <p className="text-xs text-muted-foreground">
                Off: whoever makes a contact change or proposes a new Sage person can approve it and send it to Sage, if they have Sage review
                approve access. On: someone else with that access must approve it. Approving always checks Sage first.
              </p>
            </div>
            <Switch
              id="sage-contact-review-second-approver"
              checked={value.requireSecondApprover}
              disabled={pending || !canEdit}
              onCheckedChange={(checked) => setValue({ ...value, requireSecondApprover: checked })}
            />
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
