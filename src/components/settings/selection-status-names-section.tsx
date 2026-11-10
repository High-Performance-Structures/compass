"use client"

/*
 * Settings > Workflows > Selections > Status names: rename the ten
 * selection statuses for this company. Saved as its own settings group
 * ("selection-status-names"), so it has its own Save and never touches the
 * other Selections settings. Statuses can only be renamed, not added or
 * removed; the stored status keys never change.
 */
import * as React from "react"
import { IconRestore } from "@tabler/icons-react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PROJECT_SELECTION_STATUSES, type ProjectSelectionStatus } from "@/lib/domain/selections/statuses"
import {
  DEFAULT_SELECTION_STATUS_LABELS,
  SELECTION_STATUS_NAME_MAX_LENGTH,
  resolveSelectionStatusLabels,
  selectionStatusNameProblems,
} from "@/lib/domain/selections/status-labels"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { selectionStatusNamesSettingsSchema, type SelectionStatusNamesSettings } from "@/lib/feature-settings/selection-status-names-settings"

const GROUP = FEATURE_SETTINGS["selection-status-names"]

type Draft = Readonly<Record<ProjectSelectionStatus, string>>

/** Only names that differ from the default are stored. */
function namesToSave(draft: Draft): SelectionStatusNamesSettings["names"] {
  return Object.fromEntries(
    PROJECT_SELECTION_STATUSES.flatMap((status) => {
      const name = draft[status].trim()
      return name === DEFAULT_SELECTION_STATUS_LABELS[status] ? [] : [[status, name]]
    }),
  )
}

export function SelectionStatusNamesSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Draft>(DEFAULT_SELECTION_STATUS_LABELS)
  const [triedSave, setTriedSave] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("selection-status-names")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = selectionStatusNamesSettingsSchema.safeParse(result.data.settings)
    setDraft(resolveSelectionStatusLabels(parsed.success ? parsed.data.names : GROUP.defaults.names))
    setCanEdit(result.data.canEdit)
    setTriedSave(false)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  // Checked as the admin types; shown once they try to save or a row is already wrong.
  const problems = selectionStatusNameProblems(draft)
  const hasProblems = Object.keys(problems).length > 0

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setTriedSave(true)
    const checked = selectionStatusNamesSettingsSchema.safeParse({ names: namesToSave(draft) })
    if (hasProblems || !checked.success) {
      toast.error("Fix the status names: each needs a name, and no two statuses can share one.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("selection-status-names", checked.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Status names saved.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="selection-status-names" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="selection-status-names" className="text-base font-semibold">Status names</h2>
        <p className="text-sm text-muted-foreground">
          What your company calls each selection status. The new name shows on the Selections sheet and its filters, the status pickers, the
          owner portal, print views, RFQs and new Activity entries. Statuses can be renamed but not added or removed, and automatic moves keep working.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-3" noValidate>
          <div className="max-w-xl space-y-2">
            {PROJECT_SELECTION_STATUSES.map((status) => {
              const fallback = DEFAULT_SELECTION_STATUS_LABELS[status]
              const problem = problems[status]
              const showProblem = Boolean(problem) && (triedSave || draft[status].trim() !== fallback)
              const id = `selection-status-name-${status}`
              return (
                <div key={status} className="grid items-start gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
                  <Label htmlFor={id} className="pt-2 text-sm text-muted-foreground">
                    {fallback}
                  </Label>
                  <div className="space-y-1">
                    <Input
                      id={id}
                      value={draft[status]}
                      maxLength={SELECTION_STATUS_NAME_MAX_LENGTH}
                      disabled={disabled}
                      aria-invalid={showProblem || undefined}
                      aria-describedby={showProblem ? `${id}-error` : undefined}
                      onChange={(event) => setDraft((current) => ({ ...current, [status]: event.target.value }))}
                    />
                    {showProblem ? (
                      <p id={`${id}-error`} className="text-xs text-destructive">
                        {problem}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || draft[status] === fallback}
                    aria-label={`Reset ${fallback} to its default name`}
                    onClick={() => setDraft((current) => ({ ...current, [status]: fallback }))}
                  >
                    <IconRestore className="size-4" /> Reset to default
                  </Button>
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Button type="submit" size="sm" disabled={pending}>
                Save status names
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
            )}
          </div>
        </form>
      ) : null}
    </section>
  )
}
