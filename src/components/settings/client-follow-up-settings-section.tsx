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
import { Switch } from "@/components/ui/switch"
import {
  CLIENT_FOLLOW_UP_PERIODS,
  CLIENT_FOLLOW_UP_PERIOD_LABEL,
  isClientFollowUpPeriod
  } from "@/lib/client-follow-up/leaderboard"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["client-follow-up"]

const TOGGLES: readonly { readonly key: "leaderboardEnabled" | "streaksEnabled" | "highlightLeader" | "countAutomaticEmails"; readonly label: string; readonly help: string }[] = [
  { key: "leaderboardEnabled", label: "Show the team leaderboard", help: "Turn off for a non-competitive view; the job towers and lists stay." },
  { key: "streaksEnabled", label: "Show streaks", help: "Each person's run of consecutive business days with logged client contact." },
  { key: "highlightLeader", label: "Highlight the leader", help: "Marks the person with the most logged contact in the period." },
  { key: "countAutomaticEmails", label: "Count emails Compass sends", help: "Include template and order emails sent from Compass, not just interactions people log." },
]

/** Settings → Workflows: how the Client follow-up page shows team activity. */
export function ClientFollowUpSettingsSection(): React.ReactElement {
  const { loaded, canEdit, customized, error, pending, settings: value, setSettings: setValue, save: saveSettings, reset } = useFeatureSettingsEditor("client-follow-up", {
    savedMessage: "Client follow-up settings saved.",
    resetMessage: "Client follow-up settings reset to defaults."
  })

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    saveSettings(value)
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="client-follow-up-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="client-follow-up-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          {TOGGLES.map((toggle) => (
            <div key={toggle.key} className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor={`crm-${toggle.key}`}>{toggle.label}</Label>
                <p className="text-xs text-muted-foreground">{toggle.help}</p>
              </div>
              <Switch
                id={`crm-${toggle.key}`}
                checked={value[toggle.key]}
                disabled={disabled || (toggle.key !== "leaderboardEnabled" && toggle.key !== "countAutomaticEmails" && !value.leaderboardEnabled)}
                onCheckedChange={(checked) => setValue((current) => ({ ...current, [toggle.key]: checked }))}
              />
            </div>
          ))}
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="crm-default-period">Opens on</Label>
              <p className="text-xs text-muted-foreground">The period the page shows first.</p>
            </div>
            <Select
              value={value.defaultPeriod}
              disabled={disabled}
              onValueChange={(next) => {
                if (isClientFollowUpPeriod(next)) setValue((current) => ({ ...current, defaultPeriod: next }))
              }}
            >
              <SelectTrigger id="crm-default-period" className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CLIENT_FOLLOW_UP_PERIODS.map((period) => (
                  <SelectItem key={period} value={period}>{CLIENT_FOLLOW_UP_PERIOD_LABEL[period]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
