"use client"

import * as React from "react"
import { toast } from "sonner"

import { checkDataHealthNow, getDataHealthStaff, type DataHealthView } from "@/app/actions/data-health"
import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["data-health"]

type Person = { readonly id: string; readonly name: string }

function DriftList({ title, items }: { readonly title: string; readonly items: readonly string[] }): React.ReactElement | null {
  if (items.length === 0) return null
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-medium">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {items.map((item) => (
          <li key={item} className="break-all">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DataHealthResult({ view }: { readonly view: DataHealthView }): React.ReactElement {
  const checked = new Date(view.checkedAt).toLocaleString()
  if (view.healthy) {
    return (
      <p className="text-sm text-muted-foreground">
        No drift found at {checked}: {view.statusChecks} status columns checked, and every table and column is as Compass expects.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Checked at {checked} ({view.statusChecks} status columns). Nothing was changed.
      </p>
      <DriftList
        title="Status values the record's statuses don't allow"
        items={view.statusFindings.map(
          (finding) =>
            `${finding.table}.${finding.column} = ${finding.value === null ? "(empty)" : `"${finding.value}"`}: ${finding.rows} row${finding.rows === 1 ? "" : "s"} (${finding.check})`,
        )}
      />
      <DriftList title="Tables in the database that Compass doesn't declare" items={view.schema.extraTables} />
      <DriftList title="Columns in the database that Compass doesn't declare" items={view.schema.extraColumns} />
      <DriftList title="Tables Compass declares that the database is missing" items={view.schema.missingTables} />
      <DriftList title="Columns Compass declares that the database is missing" items={view.schema.missingColumns} />
    </div>
  )
}

/** Settings › Workflows › Data health: the notice switch, who gets it, and a check on demand. */
export function DataHealthSettingsSection(): React.ReactElement {
  const { loaded, canEdit, error, pending, settings, save } = useFeatureSettingsEditor("data-health", {
    savedMessage: "Data health settings saved.",
  })
  const [people, setPeople] = React.useState<readonly Person[]>([])
  const [view, setView] = React.useState<DataHealthView | null>(null)
  const [checking, startCheck] = React.useTransition()

  React.useEffect(() => {
    void getDataHealthStaff().then((result) => {
      if (result.success) setPeople(result.data)
    })
  }, [])

  function toggleRecipient(userId: string, on: boolean): void {
    const next = new Set(settings.recipientUserIds)
    if (on) next.add(userId)
    else next.delete(userId)
    save({ ...settings, recipientUserIds: [...next] })
  }

  function checkNow(): void {
    startCheck(async () => {
      const result = await checkDataHealthNow()
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setView(result.data)
    })
  }

  return (
    <section aria-labelledby="data-health-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="data-health-settings" className="text-base font-semibold">
          {GROUP.label}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <>
          <div className="flex items-start gap-3">
            <Switch
              id="data-health-notices"
              checked={settings.notices}
              disabled={pending || !canEdit}
              onCheckedChange={(checked) => save({ ...settings, notices: checked })}
            />
            <div className="space-y-1">
              <Label htmlFor="data-health-notices">Send Data health notices</Label>
              <p className="text-xs text-muted-foreground">
                {settings.notices
                  ? "On: a notice at the bell when the daily check finds drift, when the drift changes, and when it clears."
                  : "Off: the check still runs every day, but nobody here is told."}
                {canEdit ? "" : " Only admins can change this."}
              </p>
            </div>
          </div>
          {settings.notices ? (
            <fieldset className="grid gap-2" disabled={pending || !canEdit}>
              <legend className="text-sm font-medium">Who gets the notice</legend>
              <p className="max-w-prose text-sm text-muted-foreground">
                {settings.recipientUserIds.length === 0 ? "Nobody chosen: all administrators." : "Only the people chosen here."}
              </p>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {people.map((person) => {
                  const id = `data-health-recipient-${person.id}`
                  return (
                    <label key={person.id} htmlFor={id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={id}
                        checked={settings.recipientUserIds.includes(person.id)}
                        onCheckedChange={(value) => toggleRecipient(person.id, value === true)}
                      />
                      <span>{person.name}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ) : null}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={checking || !canEdit} onClick={checkNow}>
                {checking ? "Checking…" : "Check now"}
              </Button>
              <p className="text-xs text-muted-foreground">Read-only: runs the same check and shows the result here. Sends no notice.</p>
            </div>
            {view ? <DataHealthResult view={view} /> : null}
          </div>
        </>
      ) : null}
    </section>
  )
}
