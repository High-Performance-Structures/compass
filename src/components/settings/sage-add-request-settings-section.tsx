"use client"

import * as React from "react"

import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { getUsers } from "@/app/actions/users"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { canManageUserAccessRole } from "@/lib/user-roles"

const GROUP = FEATURE_SETTINGS["sage-add-requests"]
const ANY_ADMIN = "any-admin"

type Person = { readonly id: string; readonly name: string }

/** Settings → Workflows → Adding to Sage: the one person who approves new Sage records. */
export function SageAddRequestSettingsSection(): React.ReactElement {
  const [people, setPeople] = React.useState<readonly Person[]>([])
  const { loaded, canEdit, customized, error, pending, settings: value, setSettings: setValue, save: saveSettings, reset } =
    useFeatureSettingsEditor("sage-add-requests", {
      savedMessage: "Sage approver saved.",
      resetMessage: "Sage approver reset to any admin."
    })

  React.useEffect(() => {
    void getUsers().then((users) =>
      // Approving needs admin-level judgment; only active admins are offered.
      setPeople(users
        .filter((user) => user.isActive && canManageUserAccessRole(user.role))
        .map((user) => ({ id: user.id, name: user.displayName || user.email }))
        .sort((a, b) => a.name.localeCompare(b.name))))
  }, [])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    saveSettings(value)
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
