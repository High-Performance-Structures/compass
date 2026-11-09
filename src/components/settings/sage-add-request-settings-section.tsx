"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { getUsers } from "@/app/actions/users"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { sageAddRequestSettingsSchema, type SageAddRequestSettings } from "@/lib/feature-settings/sage-add-request-settings"
import { canManageUserAccessRole } from "@/lib/user-roles"

const GROUP = FEATURE_SETTINGS["sage-add-requests"]
const ANY_ADMIN = "any-admin"

type Person = { readonly id: string; readonly name: string }

/** Settings → Workflows → Adding to Sage: the one person who approves new Sage records. */
export function SageAddRequestSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [value, setValue] = React.useState<SageAddRequestSettings>(GROUP.defaults)
  const [people, setPeople] = React.useState<readonly Person[]>([])
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const [result, users] = await Promise.all([getFeatureSettingsForEditor("sage-add-requests"), getUsers()])
    if (!result.success) {
      setError(result.error)
      return
    }
    // Approving needs admin-level judgment; only active admins are offered.
    setPeople(users
      .filter((user) => user.isActive && canManageUserAccessRole(user.role))
      .map((user) => ({ id: user.id, name: user.displayName || user.email }))
      .sort((a, b) => a.name.localeCompare(b.name)))
    const parsed = sageAddRequestSettingsSchema.safeParse(result.data.settings)
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
      const result = await saveFeatureSettings("sage-add-requests", value)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Sage approver saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("sage-add-requests")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Sage approver reset to any admin.")
      await load()
    })
  }

  return (
    <section aria-labelledby="sage-add-request-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="sage-add-request-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="max-w-sm space-y-1">
            <Label htmlFor="sage-add-approver">Approver</Label>
            <Select
              value={value.approverUserId ?? ANY_ADMIN}
              disabled={pending || !canEdit}
              onValueChange={(next) => setValue({ approverUserId: next === ANY_ADMIN ? null : next })}
            >
              <SelectTrigger id="sage-add-approver"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_ADMIN}>Any admin</SelectItem>
                {people.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              They're notified of each request that passes the duplicate check and decide whether it goes to Sage. If they leave the
              company or lose admin access, any admin can decide.
            </p>
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
