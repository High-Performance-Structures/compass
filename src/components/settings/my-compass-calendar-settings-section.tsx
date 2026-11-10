"use client"

import * as React from "react"

import { getMyCompassCalendarStaffOptions } from "@/app/actions/my-compass-calendar"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const KEY = "my-compass-calendar"
const DEFAULTS = FEATURE_SETTINGS[KEY].defaults

const ITEM_SWITCHES = [
  { key: "scheduleItems", label: "Schedule items assigned to the person" },
  { key: "todos", label: "To-dos assigned to the person" },
  { key: "projectMilestones", label: "Milestones on projects the person is on the team for" },
] as const

type StaffOption = { readonly value: string; readonly label: string }

/** Company settings for staff members' My Compass Google calendars. */
export function MyCompassCalendarSettingsSection(): React.ReactElement {
  const [daysBack, setDaysBack] = React.useState(String(DEFAULTS.daysBack))
  const [daysAhead, setDaysAhead] = React.useState(String(DEFAULTS.daysAhead))
  const [staff, setStaff] = React.useState<readonly StaffOption[]>([])
  const { settings, setSettings, loaded, canEdit, customized, error, pending, disabled, save: saveSettings, reset } =
    useFeatureSettingsEditor(KEY, {
      savedMessage: "My Compass calendar settings saved",
      resetMessage: "My Compass calendar settings reset",
      // The day counts are typed into text boxes, so they keep their own state.
      onLoaded: (value) => {
        setDaysBack(String(value.daysBack))
        setDaysAhead(String(value.daysAhead))
      },
    })

  React.useEffect(() => {
    void getMyCompassCalendarStaffOptions().then((people) => setStaff(people.success ? people.data : []))
  }, [])

  const staffLabel = (id: string): string => staff.find((person) => person.value === id)?.label ?? id

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    saveSettings({ ...settings, daysBack: Number(daysBack), daysAhead: Number(daysAhead) })
  }

  return (
    <section aria-labelledby="my-compass-calendar-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="my-compass-calendar-settings" className="text-base font-semibold">{FEATURE_SETTINGS[KEY].label}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Gives each staff member a &ldquo;My Compass&rdquo; calendar in their own Google Calendar with the work assigned to
          them. Compass keeps it current every few minutes. Changes made in Google are replaced, and finished items drop
          off. Each person can turn theirs off in Settings → Integrations.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form className="max-w-3xl space-y-5" onSubmit={save}>
          <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center sm:gap-4">
            <div>
              <Label htmlFor="my-compass-mode">Calendars</Label>
              <p className="text-xs text-muted-foreground">Try it with a few people before turning it on for all staff.</p>
            </div>
            <Select
              value={settings.mode}
              onValueChange={(value) => {
                if (value === "off" || value === "pilot" || value === "on") setSettings({ ...settings, mode: value })
              }}
              disabled={disabled}
            >
              <SelectTrigger id="my-compass-mode" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="pilot">Test people only</SelectItem>
                <SelectItem value="on">All staff</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {settings.mode === "pilot" ? (
            <div className="space-y-2">
              <Label>Test people</Label>
              <SearchableCombobox
                value=""
                onValueChange={(value) => {
                  if (value && !settings.pilotUserIds.includes(value)) {
                    setSettings({ ...settings, pilotUserIds: [...settings.pilotUserIds, value] })
                  }
                }}
                options={staff.filter((person) => !settings.pilotUserIds.includes(person.value))}
                ariaLabel="Add a test person"
                placeholder="Add a person"
                searchPlaceholder="Search staff..."
                emptyMessage="No matching staff."
                disabled={disabled}
                className="h-9 sm:max-w-md"
              />
              {settings.pilotUserIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">No test people yet, so no calendars are made.</p>
              ) : (
                <ul className="divide-y border-y text-sm sm:max-w-md">
                  {settings.pilotUserIds.map((id) => (
                    <li key={id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate">{staffLabel(id)}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        onClick={() => setSettings({ ...settings, pilotUserIds: settings.pilotUserIds.filter((item) => item !== id) })}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">What goes on each calendar</legend>
            <ul className="divide-y border-y">
              {ITEM_SWITCHES.map((item) => (
                <li key={item.key} className="flex items-center justify-between gap-3 py-2">
                  <Label htmlFor={`my-compass-${item.key}`} className="font-normal">{item.label}</Label>
                  <Switch
                    id={`my-compass-${item.key}`}
                    checked={settings[item.key]}
                    disabled={disabled}
                    onCheckedChange={(checked) => setSettings({ ...settings, [item.key]: checked })}
                  />
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Items on open and warranty jobs are included until they&apos;re complete. Items show as free time and don&apos;t
              send reminders.
            </p>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
            <div className="space-y-1.5">
              <Label htmlFor="my-compass-days-back">Days back</Label>
              <Input id="my-compass-days-back" type="number" min={0} max={60} value={daysBack} disabled={disabled}
                onChange={(event) => setDaysBack(event.target.value)} className="h-9 w-24 tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="my-compass-days-ahead">Days ahead</Label>
              <Input id="my-compass-days-ahead" type="number" min={14} max={365} value={daysAhead} disabled={disabled}
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
