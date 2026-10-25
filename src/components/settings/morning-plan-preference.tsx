"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  getMyMorningPlanPreferences,
  saveMyMorningPlanPreferences,
  type MorningPlanPreferences,
} from "@/app/actions/morning-plan"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

const HOURS = [5, 6, 7, 8, 9, 10, 11] as const

function hourLabel(hour: number): string {
  return `${hour}:00 AM`
}

/** A staff member's daily email/push of Today's plan, off unless they turn it on. */
export function MorningPlanPreferenceRow(): React.ReactElement | null {
  const [preference, setPreference] = React.useState<MorningPlanPreferences | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    let cancelled = false
    getMyMorningPlanPreferences()
      .then((result) => {
        if (!cancelled && result.success) setPreference(result.data)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  if (!preference?.digestAllowed) return null

  function save(next: { readonly digestEnabled: boolean; readonly digestHour: number }): void {
    startTransition(async () => {
      const result = await saveMyMorningPlanPreferences(next)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setPreference((current) => (current ? { ...current, ...next } : current))
      toast.success(next.digestEnabled ? `Today's plan will arrive at ${hourLabel(next.digestHour)}.` : "Daily plan email turned off.")
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <Label htmlFor="morning-plan-digest" className="text-xs">Daily plan email</Label>
        <p className="text-muted-foreground text-xs">
          Today&apos;s plan by email and push each morning, in the company&apos;s time zone. It&apos;s always on your dashboard.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={String(preference.digestHour)}
          disabled={pending || !preference.digestEnabled}
          onValueChange={(value) => save({ digestEnabled: preference.digestEnabled, digestHour: Number(value) })}
        >
          <SelectTrigger className="h-8 w-28" aria-label="Daily plan time">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HOURS.map((hour) => (
              <SelectItem key={hour} value={String(hour)}>
                {hourLabel(hour)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Switch
          id="morning-plan-digest"
          checked={preference.digestEnabled}
          disabled={pending}
          onCheckedChange={(checked) => save({ digestEnabled: checked, digestHour: preference.digestHour })}
        />
      </div>
    </div>
  )
}
