"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  getFeatureSettingsForEditor,
  resetFeatureSettings,
  saveFeatureSettings,
} from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  CLIENT_FOLLOW_UP_PERIODS,
  CLIENT_FOLLOW_UP_PERIOD_LABEL,
  clientFollowUpSettingsSchema,
  isClientFollowUpPeriod,
  type ClientFollowUpSettings,
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
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [value, setValue] = React.useState<ClientFollowUpSettings>(GROUP.defaults)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("client-follow-up")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = clientFollowUpSettingsSchema.safeParse(result.data.settings)
    setValue(parsed.success ? parsed.data : GROUP.defaults)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveFeatureSettings("client-follow-up", value)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Client follow-up settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("client-follow-up")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Client follow-up settings reset to defaults.")
      await load()
    })
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
