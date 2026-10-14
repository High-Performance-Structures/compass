"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { getUsers } from "@/app/actions/users"
import { isInternalStaffRole } from "@/lib/user-roles"
import { Button } from "@/components/ui/button"
import { IconPlus, IconTrash } from "@tabler/icons-react"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { squarePaymentSettingsSchema, type SquarePaymentSettings } from "@/lib/feature-settings/registry"

type Person = { readonly id: string; readonly name: string; readonly role: string }
type AlertKey = "connectionAlertUserIds" | "paymentAlertUserIds" | "receiptReminderUserIds"
type Mapping = { readonly key: string; readonly sageUsername: string; readonly userId: string }

const GROUPS: ReadonlyArray<{ readonly key: AlertKey; readonly title: string; readonly help: string; readonly fallback: string }> = [
  {
    key: "connectionAlertUserIds",
    title: "Square connection alerts",
    help: "When the link between Compass, Sage and Square stops working or comes back.",
    fallback: "Nobody chosen: only the developer set up on the server.",
  },
  {
    key: "paymentAlertUserIds",
    title: "Square payment alerts",
    help: "A Square payment to post in Sage, or a payment Compass couldn't match.",
    fallback: "Nobody chosen: all administrators.",
  },
  {
    key: "receiptReminderUserIds",
    title: "Also reminded about receipts not entered in Sage",
    help: "Reminders go to whoever created the Sage invoice, matched below, plus these people.",
    fallback: "Nobody chosen: the Square payment alert people.",
  },
]

/** Settings → Workflows → Square and Sage payments: who gets Square alerts at the bell. */
export function SquareAlertSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [people, setPeople] = React.useState<readonly Person[]>([])
  const [chosen, setChosen] = React.useState<Readonly<Record<AlertKey, ReadonlySet<string>>>>({
    connectionAlertUserIds: new Set(),
    paymentAlertUserIds: new Set(),
    receiptReminderUserIds: new Set(),
  })
  const [mappings, setMappings] = React.useState<readonly Mapping[]>([])
  const [reminderHours, setReminderHours] = React.useState("24")
  const [businessHoursOnly, setBusinessHoursOnly] = React.useState(true)
  const [timeZone, setTimeZone] = React.useState("America/Denver")
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const [result, users] = await Promise.all([getFeatureSettingsForEditor("square-payments"), getUsers()])
    if (!result.success) {
      setError(result.error)
      return
    }
    setPeople(
      users
        // Internal process work: staff only, never subs, suppliers or clients.
        .filter((user) => isInternalStaffRole(user.role) || user.role === "developer")
        .map((user) => ({ id: user.id, name: user.displayName || user.email, role: user.role }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
    const parsed = squarePaymentSettingsSchema.safeParse(result.data.settings)
    const value: SquarePaymentSettings | null = parsed.success ? parsed.data : null
    setChosen({
      connectionAlertUserIds: new Set(value?.connectionAlertUserIds ?? []),
      paymentAlertUserIds: new Set(value?.paymentAlertUserIds ?? []),
      receiptReminderUserIds: new Set(value?.receiptReminderUserIds ?? []),
    })
    setMappings((value?.sageUserMappings ?? []).map((row) => ({ key: crypto.randomUUID(), ...row })))
    setReminderHours(String(value?.receiptReminderHours ?? 24))
    setBusinessHoursOnly(value?.receiptReminderBusinessHoursOnly ?? true)
    setTimeZone(value?.timeZone ?? "America/Denver")
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function toggle(key: AlertKey, userId: string, on: boolean): void {
    setChosen((current) => {
      const next = new Set(current[key])
      if (on) next.add(userId)
      else next.delete(userId)
      return { ...current, [key]: next }
    })
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const hours = Number(reminderHours)
      if (!Number.isInteger(hours) || hours < 0 || hours > 168) {
        toast.error("Hours between reminders must be a whole number from 0 to 168")
        return
      }
      const result = await saveFeatureSettings("square-payments", {
        connectionAlertUserIds: [...chosen.connectionAlertUserIds],
        paymentAlertUserIds: [...chosen.paymentAlertUserIds],
        receiptReminderUserIds: [...chosen.receiptReminderUserIds],
        sageUserMappings: mappings
          .filter((row) => row.sageUsername.trim() !== "" && row.userId !== "")
          .map((row) => ({ sageUsername: row.sageUsername.trim(), userId: row.userId })),
        receiptReminderHours: hours,
        receiptReminderBusinessHoursOnly: businessHoursOnly,
        timeZone: timeZone.trim() || "America/Denver",
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Square alert settings saved")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("square-payments")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Square alert settings reset")
      await load()
    })
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!loaded) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <form onSubmit={save} className="grid gap-6">
      {GROUPS.map((group) => (
        <fieldset key={group.key} className="grid gap-2" disabled={!canEdit || pending}>
          <legend className="text-sm font-medium">{group.title}</legend>
          <p className="max-w-prose text-sm text-muted-foreground">
            {group.help} {chosen[group.key].size === 0 ? group.fallback : null}
          </p>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((person) => {
              const id = `${group.key}-${person.id}`
              return (
                <label key={person.id} htmlFor={id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={id}
                    checked={chosen[group.key].has(person.id)}
                    onCheckedChange={(value) => toggle(group.key, person.id, value === true)}
                  />
                  <span>{person.name}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}
      <fieldset className="grid gap-2" disabled={!canEdit || pending}>
        <legend className="text-sm font-medium">Who created the Sage invoice</legend>
        <p className="max-w-prose text-sm text-muted-foreground">
          Match each Sage login (exactly as Sage shows who entered an invoice, often COMPUTER\name) to the person in Compass. They&apos;re told when
          Square pays an invoice they created, and reminded until the receipt is entered in Sage. An unmatched login is
          flagged to the Square payment alert people.
        </p>
        <div className="grid gap-2">
          {mappings.map((row, index) => (
            <div key={row.key} className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-56"
                aria-label={`Sage login ${index + 1}`}
                placeholder="Sage login"
                value={row.sageUsername}
                maxLength={100}
                onChange={(event) => setMappings((current) => current.map((item) => (item.key === row.key ? { ...item, sageUsername: event.target.value } : item)))}
              />
              <Select
                value={row.userId}
                onValueChange={(userId) => setMappings((current) => current.map((item) => (item.key === row.key ? { ...item, userId } : item)))}
              >
                <SelectTrigger className="h-8 w-56" aria-label={`Compass person for Sage login ${index + 1}`}>
                  <SelectValue placeholder="Choose a person" />
                </SelectTrigger>
                <SelectContent>
                  {people.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove Sage login ${index + 1}`}
                onClick={() => setMappings((current) => current.filter((item) => item.key !== row.key))}
              >
                <IconTrash className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMappings((current) => [...current, { key: crypto.randomUUID(), sageUsername: "", userId: "" }])}
          >
            <IconPlus className="size-4" />
            Add Sage login
          </Button>
        </div>
      </fieldset>
      <fieldset className="grid gap-3" disabled={!canEdit || pending}>
        <legend className="text-sm font-medium">Receipt reminders</legend>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="square-reminder-hours">Remind every</label>
          <Input
            id="square-reminder-hours"
            className="h-8 w-20"
            inputMode="numeric"
            value={reminderHours}
            onChange={(event) => setReminderHours(event.target.value)}
          />
          <span>hours until the receipt is in Sage (0 turns reminders off).</span>
        </div>
        <label htmlFor="square-reminder-business-hours" className="flex items-center gap-2 text-sm">
          <Switch id="square-reminder-business-hours" checked={businessHoursOnly} onCheckedChange={setBusinessHoursOnly} />
          Only on weekdays, 7 AM to 5 PM
        </label>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="square-reminder-time-zone">Time zone</label>
          <Input
            id="square-reminder-time-zone"
            className="h-8 w-48"
            value={timeZone}
            maxLength={64}
            onChange={(event) => setTimeZone(event.target.value)}
          />
        </div>
        <p className="max-w-prose text-sm text-muted-foreground">
          Compass checks Sage every few minutes and stops reminding once the receipt is entered.
        </p>
      </fieldset>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            Save
          </Button>
          {customized ? (
            <Button type="button" variant="outline" disabled={pending} onClick={reset}>
              Reset to defaults
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only administrators can change these settings.</p>
      )}
    </form>
  )
}
