"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  getDailyLogReminderPreference,
  setDailyLogReminderTime,
  type DailyLogReminderPreference,
} from "@/app/actions/daily-log-reminder-preference"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { clockLabel } from "@/lib/daily-logs/reminders"

/** A person's own daily log reminder time, shown when their company allows it. */
export function DailyLogReminderPreferenceRow(): React.ReactElement | null {
  const [preference, setPreference] = React.useState<DailyLogReminderPreference | null>(null)
  const [time, setTime] = React.useState("")
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    let cancelled = false
    getDailyLogReminderPreference()
      .then((result) => {
        if (cancelled || !result) return
        setPreference(result)
        setTime(result.ownTime ?? result.companyTime)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  if (!preference?.allowed) return null

  function save(next: string | null): void {
    startTransition(async () => {
      const result = await setDailyLogReminderTime(next)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setPreference((current) => (current ? { ...current, ownTime: next } : current))
      if (next === null && preference) setTime(preference.companyTime)
      toast.success(next ? `Daily log reminder at ${clockLabel(next)}.` : "Using the company's reminder time.")
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <Label htmlFor="daily-log-reminder-time" className="text-xs">Daily log reminder</Label>
        <p className="text-muted-foreground text-xs">
          When you haven&apos;t written a daily log on a work day. Company time: {clockLabel(preference.companyTime)}.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          id="daily-log-reminder-time"
          type="time"
          value={time}
          disabled={pending}
          onChange={(event) => setTime(event.target.value)}
          className="w-32"
        />
        <Button type="button" size="sm" variant="outline" disabled={pending || !time || time === (preference.ownTime ?? preference.companyTime)} onClick={() => save(time)}>
          Save
        </Button>
        {preference.ownTime ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => save(null)}>
            Use company time
          </Button>
        ) : null}
      </div>
    </div>
  )
}
