"use client"

import * as React from "react"
import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["sage-contact-review"]

/** Settings → Workflows: who approves Sage contact changes, and how staff follow their Sage employee record. */
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="sage-contact-review-auto-link-employees">Link staff to their Sage employee by email</Label>
              <p className="text-xs text-muted-foreground">
                On (default): when Compass reads Sage&apos;s employee list, an unlinked staff member is linked to the one current Sage employee
                with the same email, and given an internal contact if they have none. Two matches either way are left for you in Sage review.
                Names never link anyone.
              </p>
            </div>
            <Switch
              id="sage-contact-review-auto-link-employees"
              checked={value.autoLinkEmployeesByEmail}
              disabled={pending || !canEdit}
              onCheckedChange={(checked) => setValue({ ...value, autoLinkEmployeesByEmail: checked })}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="sage-contact-review-employee-status">Staff contacts follow their Sage employee status</Label>
              <p className="text-xs text-muted-foreground">
                On (default): a linked staff contact becomes inactive when Sage shows the employee as not current, and active again when
                current. Their Compass login is not changed; an inactive contact loses automatic field app access.
              </p>
            </div>
            <Switch
              id="sage-contact-review-employee-status"
              checked={value.employeeStatusFollowsSage}
              disabled={pending || !canEdit}
              onCheckedChange={(checked) => setValue({ ...value, employeeStatusFollowsSage: checked })}
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
