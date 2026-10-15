"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { DAILY_LOG_TODO_TYPE_LABELS, DAILY_LOG_TODO_TYPES, type DailyLogTodoMode } from "@/lib/daily-logs/log-followups"
import {
  dailyLogFollowUpSettingsSchema,
  FEATURE_SETTINGS,
  type DailyLogFollowUpSettings,
} from "@/lib/feature-settings/registry"

const KEY = "daily-log-followups"
const DEFAULTS = FEATURE_SETTINGS[KEY].defaults

const TODO_MODES: readonly { readonly value: DailyLogTodoMode; readonly label: string; readonly help: string }[] = [
  { value: "ask", label: "The crew flags which lines become to-dos", help: "Each issue and next-step line gets a Make to-do button." },
  { value: "auto", label: "Every line becomes a to-do", help: "The crew can turn a line back into a note; the office assigns the rest." },
  { value: "off", label: "Lines stay notes only", help: "Daily logs don't create to-dos." },
]

function SwitchRow({
  id,
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  readonly id: string
  readonly label: string
  readonly help: string
  readonly checked: boolean
  readonly disabled: boolean
  readonly onChange: (checked: boolean) => void
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  )
}

/**
 * How daily logs create and update to-dos and record client contact. Shown
 * under the daily log settings; Field Mode picks up changes when phones next
 * refresh their projects.
 */
export function DailyLogFollowUpSettingsSection(): React.ReactElement {
  const [settings, setSettings] = React.useState<DailyLogFollowUpSettings>(DEFAULTS)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor(KEY)
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = dailyLogFollowUpSettingsSchema.safeParse(result.data.settings)
    setSettings(parsed.success ? parsed.data : DEFAULTS)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const disabled = pending || !canEdit
  const update = (patch: Partial<DailyLogFollowUpSettings>): void => setSettings((current) => ({ ...current, ...patch }))

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = dailyLogFollowUpSettingsSchema.safeParse(settings)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the to-do settings.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings(KEY, parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Saved. Phones pick up the change when they next refresh.")
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
      toast.success("Back to the defaults.")
      await load()
    })
  }

  return (
    <section aria-labelledby="daily-log-followup-settings" className="space-y-6 border-b pb-6">
      <div>
        <h2 id="daily-log-followup-settings" className="text-base font-semibold">{FEATURE_SETTINGS[KEY].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS[KEY].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <form onSubmit={save} className="grid max-w-2xl gap-6">
        <fieldset className="grid gap-3">
          <legend className="text-sm font-semibold">Issues and next steps</legend>
          <RadioGroup
            value={settings.todoMode}
            onValueChange={(value) => {
              const mode = TODO_MODES.find((item) => item.value === value)
              if (mode) update({ todoMode: mode.value })
            }}
            disabled={disabled}
            className="grid gap-2"
          >
            {TODO_MODES.map((mode) => (
              <div key={mode.value} className="flex items-start gap-3">
                <RadioGroupItem id={`daily-log-todo-mode-${mode.value}`} value={mode.value} className="mt-0.5" />
                <Label htmlFor={`daily-log-todo-mode-${mode.value}`} className="grid gap-0.5 font-normal">
                  <span className="font-medium">{mode.label}</span>
                  <span className="text-xs text-muted-foreground">{mode.help}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
          <div className="grid gap-2">
            <p className="text-sm font-medium">The crew can create</p>
            <div className="flex flex-wrap gap-4">
              {DAILY_LOG_TODO_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={settings.todoTypes.includes(type)}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      update({
                        todoTypes: checked === true
                          ? DAILY_LOG_TODO_TYPES.filter((item) => item === type || settings.todoTypes.includes(item))
                          : settings.todoTypes.filter((item) => item !== type),
                      })
                    }
                  />
                  {DAILY_LOG_TODO_TYPE_LABELS[type]}s
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="text-sm font-semibold">To-dos worked on</legend>
          <SwitchRow
            id="daily-log-worked-progress"
            label="Move Open to-dos to In progress"
            help="Ticking a to-do always adds the day's note to its history. Finishing a to-do is always a person's choice."
            checked={settings.workedMovesToInProgress}
            disabled={disabled}
            onChange={(workedMovesToInProgress) => update({ workedMovesToInProgress })}
          />
          <SwitchRow
            id="daily-log-carry-blocked"
            label="Show blocked to-dos on the next log"
            help="The crew answers Still blocked or Cleared today."
            checked={settings.carryBlocked}
            disabled={disabled}
            onChange={(carryBlocked) => update({ carryBlocked })}
          />
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="daily-log-finish-nudge">Ask “Is it finished?” after</Label>
              <p className="text-xs text-muted-foreground">Daily logs that worked on a to-do while it stays open.</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="daily-log-finish-nudge"
                type="number"
                min={1}
                max={30}
                value={settings.finishNudgeAfterLogs}
                disabled={disabled}
                onChange={(event) => update({ finishNudgeAfterLogs: Number(event.target.value) })}
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">logs</span>
            </div>
          </div>
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="text-sm font-semibold">To-dos and cost codes</legend>
          <SwitchRow
            id="daily-log-todo-codes"
            label="To-dos can carry a cost code"
            help="From the same list the job's daily logs use. Sub and supplier to-dos can leave it blank."
            checked={settings.todoCostCodes}
            disabled={disabled}
            onChange={(todoCostCodes) => update({ todoCostCodes })}
          />
          <SwitchRow
            id="daily-log-tick-line"
            label="Ticking a to-do adds a cost code line"
            help="Filled in with its code and title; the crew enters the hours, which add up on the to-do."
            checked={settings.tickAddsLine}
            disabled={disabled || !settings.todoCostCodes}
            onChange={(tickAddsLine) => update({ tickAddsLine })}
          />
          <SwitchRow
            id="daily-log-crew-code"
            label="The crew picks the cost code on a new to-do"
            help="Off: the office sets it when assigning."
            checked={settings.crewPicksCostCode}
            disabled={disabled || !settings.todoCostCodes}
            onChange={(crewPicksCostCode) => update({ crewPicksCostCode })}
          />
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="text-sm font-semibold">Client contact</legend>
          <p className="text-xs text-muted-foreground">
            Saved as a client interaction, the same as one logged on the project. The shortest summary that counts and how far back it can be dated come from the Client interactions settings.
          </p>
          <SwitchRow
            id="daily-log-client-contact"
            label="Show Client contact on daily logs"
            help="In the browser and in Field Mode."
            checked={settings.clientContact}
            disabled={disabled}
            onChange={(clientContact) => update({ clientContact })}
          />
          <SwitchRow
            id="daily-log-client-suggest"
            label="Suggest it when Visitors names a client contact"
            help="One tap fills in who and the type; the crew writes what happened."
            checked={settings.clientContactSuggest}
            disabled={disabled || !settings.clientContact}
            onChange={(clientContactSuggest) => update({ clientContactSuggest })}
          />
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <>
              <Button type="submit" size="sm" disabled={pending}>Save</Button>
              {customized ? (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to defaults</Button>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
          )}
        </div>
      </form>
    </section>
  )
}
