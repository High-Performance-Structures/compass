"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { getMyCompassCalendarStaffOptions } from "@/app/actions/my-compass-calendar"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  FEATURE_SETTINGS,
  projectCalendarSettingsSchema,
  type ProjectCalendarSettings,
} from "@/lib/feature-settings/registry"

const KEY = "project-calendars"
const DEFAULTS = FEATURE_SETTINGS[KEY].defaults

const ITEM_SWITCHES = [
  { key: "milestones", label: "Milestones" },
  { key: "scheduleItems", label: "Other schedule items" },
  { key: "workCalendarEvents", label: "Work Calendar events for the job (company-wide visibility only)" },
  { key: "clientMeetings", label: "Project meetings, with the Meet link" },
] as const

type StaffOption = { readonly value: string; readonly label: string }

/** Company settings for per-job Google calendars. */
export function ProjectCalendarSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [settings, setSettings] = React.useState<ProjectCalendarSettings>(DEFAULTS)
  const [daysBack, setDaysBack] = React.useState(String(DEFAULTS.daysBack))
  const [daysAhead, setDaysAhead] = React.useState(String(DEFAULTS.daysAhead))
  const [staff, setStaff] = React.useState<readonly StaffOption[]>([])
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const [result, people] = await Promise.all([getFeatureSettingsForEditor(KEY), getMyCompassCalendarStaffOptions()])
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = projectCalendarSettingsSchema.safeParse(result.data.settings)
    const value = parsed.success ? parsed.data : DEFAULTS
    setSettings(value)
    setDaysBack(String(value.daysBack))
    setDaysAhead(String(value.daysAhead))
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setStaff(people.success ? people.data : [])
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const disabled = !canEdit || pending
  const staffLabel = (id: string): string => staff.find((person) => person.value === id)?.label ?? id

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveFeatureSettings(KEY, { ...settings, daysBack: Number(daysBack), daysAhead: Number(daysAhead) })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Project calendar settings saved")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings(KEY)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Project calendar settings reset")
      await load()
    })
  }

  return (
    <section aria-labelledby="project-calendar-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="project-calendar-settings" className="text-base font-semibold">{FEATURE_SETTINGS[KEY].label}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Gives a job its own Google calendar with its schedule, events and project meetings. The company&apos;s Compass
          Google account owns each calendar, and it&apos;s shared only with staff, never with clients or vendors. Compass
          keeps it current every few minutes and replaces changes made in Google. Turning a job&apos;s calendar off, or
          closing the job, deletes the calendar from Google.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form className="max-w-3xl space-y-5" onSubmit={save}>
          <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center sm:gap-4">
            <div>
              <Label htmlFor="project-calendars-mode">Which jobs get a calendar</Label>
              <p className="text-xs text-muted-foreground">
                Every job starts without a calendar. Office staff create one from the Project Google calendar section
                on a job&apos;s Information page.
              </p>
            </div>
            <Select
              value={settings.mode}
              onValueChange={(value) => {
                if (value === "off" || value === "selected" || value === "open") setSettings({ ...settings, mode: value })
              }}
              disabled={disabled}
            >
              <SelectTrigger id="project-calendars-mode" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Not offered</SelectItem>
                <SelectItem value="selected">Only jobs staff choose</SelectItem>
                <SelectItem value="open">Every open and warranty job</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center sm:gap-4">
            <div>
              <Label htmlFor="project-calendars-share">Shared with</Label>
              <p className="text-xs text-muted-foreground">Staff can only view; changes are made in Compass.</p>
            </div>
            <Select
              value={settings.shareWith}
              onValueChange={(value) => {
                if (value === "project" || value === "all") setSettings({ ...settings, shareWith: value })
              }}
              disabled={disabled}
            >
              <SelectTrigger id="project-calendars-share" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="project">Staff on the job&apos;s team</SelectItem>
                <SelectItem value="all">All staff</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3 border-y py-2">
            <div>
              <Label htmlFor="project-calendars-list" className="font-normal">Add it to each person&apos;s Google Calendar</Label>
              <p className="text-xs text-muted-foreground">Added once; anyone can hide or remove it in Google afterward.</p>
            </div>
            <Switch
              id="project-calendars-list"
              checked={settings.addToStaffCalendars}
              disabled={disabled}
              onCheckedChange={(checked) => setSettings({ ...settings, addToStaffCalendars: checked })}
            />
          </div>

          <div className="space-y-2">
            <Label>Never share with</Label>
            <SearchableCombobox
              value=""
              onValueChange={(value) => {
                if (value && !settings.excludedUserIds.includes(value)) {
                  setSettings({ ...settings, excludedUserIds: [...settings.excludedUserIds, value] })
                }
              }}
              options={staff.filter((person) => !settings.excludedUserIds.includes(person.value))}
              ariaLabel="Add a person who never gets project calendars"
              placeholder="Add a person, such as a system account"
              searchPlaceholder="Search staff..."
              emptyMessage="No matching staff."
              disabled={disabled}
              className="h-9 sm:max-w-md"
            />
            {settings.excludedUserIds.length > 0 ? (
              <ul className="divide-y border-y text-sm sm:max-w-md">
                {settings.excludedUserIds.map((id) => (
                  <li key={id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate">{staffLabel(id)}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => setSettings({ ...settings, excludedUserIds: settings.excludedUserIds.filter((item) => item !== id) })}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">What goes on each calendar</legend>
            <ul className="divide-y border-y">
              {ITEM_SWITCHES.map((item) => (
                <li key={item.key} className="flex items-center justify-between gap-3 py-2">
                  <Label htmlFor={`project-calendars-${item.key}`} className="font-normal">{item.label}</Label>
                  <Switch
                    id={`project-calendars-${item.key}`}
                    checked={settings[item.key]}
                    disabled={disabled}
                    onCheckedChange={(checked) => setSettings({ ...settings, [item.key]: checked })}
                  />
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Events show as free time and don&apos;t send reminders.</p>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
            <div className="space-y-1.5">
              <Label htmlFor="project-calendars-days-back">Days back</Label>
              <Input id="project-calendars-days-back" type="number" min={0} max={60} value={daysBack} disabled={disabled}
                onChange={(event) => setDaysBack(event.target.value)} className="h-9 w-24 tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-calendars-days-ahead">Days ahead</Label>
              <Input id="project-calendars-days-ahead" type="number" min={14} max={365} value={daysAhead} disabled={disabled}
                onChange={(event) => setDaysAhead(event.target.value)} className="h-9 w-24 tabular-nums" />
            </div>
          </div>

          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={pending}>Save</Button>
              {customized ? (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to defaults</Button>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
          )}
        </form>
      ) : null}
    </section>
  )
}
