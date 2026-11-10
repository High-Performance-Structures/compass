"use client"

import * as React from "react"
import { toast } from "sonner"
import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  FEATURE_SETTINGS,
  scheduleConflictSettingsSchema,
  type ScheduleConflictSettingsValue
} from "@/lib/feature-settings/registry"


function aliasLines(settings: ScheduleConflictSettingsValue): string {
  return settings.aliases.map((alias) => `${alias.from} = ${alias.to}`).join("\n")
}

/** "GP Framing = GFGP Framing, LLC" lines; lines without " = " are ignored. */
function parseAliases(text: string): ScheduleConflictSettingsValue["aliases"] {
  return text.split("\n").flatMap((line) => {
    const index = line.indexOf("=")
    if (index < 0) return []
    const from = line.slice(0, index).trim()
    const to = line.slice(index + 1).trim()
    return from && to ? [{ from, to }] : []
  })
}

/**
 * Schedule conflicts: names never flagged (one per line) and other spellings
 * of the same name ("old = new" per line).
 */
export function ScheduleConflictSettingsSection(): React.ReactElement {
  // The lists are edited as text, one entry per line.
  const [ignored, setIgnored] = React.useState("")
  const [aliases, setAliases] = React.useState("")
  const { error, disabled, save: saveSettings } = useFeatureSettingsEditor("schedule-conflicts", {
    savedMessage: "Schedule conflict settings saved.",
    onLoaded: (settings) => {
      setIgnored(settings.ignoredParties.join("\n"))
      setAliases(aliasLines(settings))
    }
  })

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = scheduleConflictSettingsSchema.safeParse({
      ignoredParties: ignored.split("\n").map((line) => line.trim()).filter(Boolean),
      aliases: parseAliases(aliases)
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the schedule conflict settings.")
      return
    }
    saveSettings(parsed.data)
  }

  return (
    <section aria-labelledby="schedule-conflict-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="schedule-conflict-settings" className="text-base font-semibold">{FEATURE_SETTINGS["schedule-conflicts"].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS["schedule-conflicts"].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <form className="grid gap-4 lg:grid-cols-2" onSubmit={save}>
        <div className="grid gap-1.5">
          <Label htmlFor="schedule-conflict-ignored">Never flag</Label>
          <Textarea
            id="schedule-conflict-ignored"
            value={ignored}
            disabled={disabled}
            onChange={(event) => setIgnored(event.target.value)}
            placeholder={"One name per line, e.g.\nHigh Performance Structures"}
            className="min-h-32"
          />
          <p className="text-xs text-muted-foreground">For a company with several crews that can work two jobs at once.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="schedule-conflict-aliases">Same name, other spellings</Label>
          <Textarea
            id="schedule-conflict-aliases"
            value={aliases}
            disabled={disabled}
            onChange={(event) => setAliases(event.target.value)}
            placeholder={"One per line: other spelling = name\nGP Framing = GFGP Framing, LLC"}
            className="min-h-32"
          />
          <p className="text-xs text-muted-foreground">
            Common differences (Inc., LLC, punctuation, capitals) already match without an entry.
          </p>
        </div>
        <div className="lg:col-span-2">
          <Button type="submit" disabled={disabled}>
            Save
          </Button>
        </div>
      </form>
    </section>
  )
}
