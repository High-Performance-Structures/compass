"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { getUsers } from "@/app/actions/users"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { squarePaymentSettingsSchema } from "@/lib/feature-settings/registry"

type Person = { readonly id: string; readonly name: string; readonly role: string }
type AlertKey = "connectionAlertUserIds" | "paymentAlertUserIds"

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
  })
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const [result, users] = await Promise.all([getFeatureSettingsForEditor("square-payments"), getUsers()])
    if (!result.success) {
      setError(result.error)
      return
    }
    setPeople(
      users
        .map((user) => ({ id: user.id, name: user.displayName || user.email, role: user.role }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
    const parsed = squarePaymentSettingsSchema.safeParse(result.data.settings)
    setChosen({
      connectionAlertUserIds: new Set(parsed.success ? parsed.data.connectionAlertUserIds : []),
      paymentAlertUserIds: new Set(parsed.success ? parsed.data.paymentAlertUserIds : []),
    })
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
      const result = await saveFeatureSettings("square-payments", {
        connectionAlertUserIds: [...chosen.connectionAlertUserIds],
        paymentAlertUserIds: [...chosen.paymentAlertUserIds],
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
