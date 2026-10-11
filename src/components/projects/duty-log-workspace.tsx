"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  deleteDutyEntry,
  saveDutyEntry,
  setProjectWorkspaceKind,
  type DutyLogEntryView,
  type DutyLogWorkspace,
  type UncategorizedLogView,
} from "@/app/actions/internal-duties"
import { RecurringDutiesBoard } from "@/components/projects/recurring-duties-board"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function formatDate(value: string): string {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

type FormState = {
  readonly entryId: string | null
  readonly dailyLogId: string | null
  readonly entryDate: string
  readonly dutyCode: string
  readonly hours: string
  readonly notes: string
  readonly relatedProjectId: string
}

const NO_PROJECT = "__none__"

function blankForm(): FormState {
  return { entryId: null, dailyLogId: null, entryDate: today(), dutyCode: "", hours: "", notes: "", relatedProjectId: NO_PROJECT }
}

export function DutyLogWorkspaceView({ workspace }: { readonly workspace: DutyLogWorkspace }): React.ReactElement {
  const router = useRouter()
  const [form, setForm] = React.useState<FormState | null>(null)
  const [pending, startTransition] = React.useTransition()
  const { project } = workspace

  const dutyOptions = workspace.duties.map((duty) => ({ value: duty.code, label: `${duty.code} ${duty.label}`, keywords: duty.label }))
  const projectOptions = [{ value: NO_PROJECT, label: "None" }, ...workspace.relatedProjects]
  const maxHours = Math.max(1, ...workspace.summary.map((row) => row.hours))

  function makeWorkspace(kind: "office" | "field"): void {
    startTransition(async () => {
      const result = await setProjectWorkspaceKind(project.id, kind)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(kind === "office" ? "Now an office workspace" : "Now a field workspace")
      router.refresh()
    })
  }

  function startFromLog(log: UncategorizedLogView): void {
    setForm({
      entryId: null,
      dailyLogId: log.id,
      entryDate: log.logDate.slice(0, 10),
      dutyCode: "",
      hours: log.hours ? String(log.hours) : "",
      notes: log.text,
      relatedProjectId: NO_PROJECT,
    })
  }

  function startEdit(entry: DutyLogEntryView): void {
    setForm({
      entryId: entry.id,
      dailyLogId: entry.dailyLogId,
      entryDate: entry.entryDate,
      dutyCode: entry.dutyCode,
      hours: entry.hours ? String(entry.hours) : "",
      notes: entry.notes ?? "",
      relatedProjectId: entry.relatedProjectId ?? NO_PROJECT,
    })
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!form) return
    startTransition(async () => {
      const result = await saveDutyEntry(project.id, form.entryId, {
        entryDate: form.entryDate,
        dutyCode: form.dutyCode,
        hours: form.hours,
        notes: form.notes,
        relatedProjectId: form.relatedProjectId === NO_PROJECT ? null : form.relatedProjectId,
        dailyLogId: form.entryId ? null : form.dailyLogId,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(form.entryId ? "Entry updated" : "Duty logged")
      setForm(null)
      router.refresh()
    })
  }

  function remove(entry: DutyLogEntryView): void {
    startTransition(async () => {
      const result = await deleteDutyEntry(project.id, entry.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(entry.dailyLogId ? "Entry deleted; its daily log is waiting for a duty again" : "Entry deleted")
      router.refresh()
    })
  }

  if (!project.workspaceKind) {
    return (
      <section className="grid gap-3 border-t pt-4 text-sm">
        <p className="text-muted-foreground">
          {project.label} is a regular project. The duty log is for internal workspaces, such as H-Office or the yard.
        </p>
        {workspace.canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => makeWorkspace("office")}>
              Make it an office workspace
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => makeWorkspace("field")}>
              Make it a field workspace
            </Button>
          </div>
        ) : null}
      </section>
    )
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {project.workspaceKind === "office" ? "Office workspace" : "Field workspace"}. Each duty is a cost code, so hours match how
          payroll is coded.
        </p>
        {workspace.canEdit && !form ? (
          <Button type="button" onClick={() => setForm(blankForm())}>
            Log duty
          </Button>
        ) : null}
      </div>

      {form ? (
        <form onSubmit={save} className="grid gap-4 border-y py-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={form.entryId ? "Edit duty entry" : "New duty entry"}>
          <div className="grid gap-1.5">
            <Label htmlFor="duty-date">Date</Label>
            <Input id="duty-date" type="date" value={form.entryDate} onChange={(event) => setForm({ ...form, entryDate: event.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="duty-code">Duty</Label>
            <SearchableCombobox
              id="duty-code"
              ariaLabel="Duty"
              placeholder="Choose a duty"
              searchPlaceholder="Search duties..."
              options={dutyOptions}
              value={form.dutyCode}
              onValueChange={(value) => setForm({ ...form, dutyCode: value })}
              className="w-full"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="duty-hours">Hours</Label>
            <Input
              id="duty-hours"
              inputMode="decimal"
              placeholder="2.5"
              value={form.hours}
              onChange={(event) => setForm({ ...form, hours: event.target.value.replace(/[^0-9.]/g, "") })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="duty-project">For project (optional)</Label>
            <SearchableCombobox
              id="duty-project"
              ariaLabel="For project"
              placeholder="None"
              searchPlaceholder="Search projects..."
              options={projectOptions}
              value={form.relatedProjectId}
              onValueChange={(value) => setForm({ ...form, relatedProjectId: value || NO_PROJECT })}
              className="w-full"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2 lg:col-span-4">
            <Label htmlFor="duty-notes">Notes</Label>
            <Textarea id="duty-notes" rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            {form.dailyLogId ? <p className="text-sm text-muted-foreground">Categorizes an existing daily log. The log itself stays as it is.</p> : null}
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" disabled={pending}>
              {form.entryId ? "Save changes" : "Save"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {project.workspaceKind === "office" || workspace.recurring.length > 0 ? (
        <RecurringDutiesBoard
          projectId={project.id}
          duties={workspace.recurring}
          dutyOptions={workspace.duties}
          staff={workspace.staff}
          canEdit={workspace.canEdit}
          canManage={workspace.canManage}
          currentUserId={workspace.currentUserId}
        />
      ) : null}

      <section aria-labelledby="duty-summary" className="grid gap-2">
        <h2 id="duty-summary" className="text-sm font-semibold">
          Hours in {monthLabel(workspace.summaryMonth)} by duty
        </h2>
        {workspace.summary.length === 0 ? (
          <p className="text-sm text-muted-foreground">No duties logged this month yet.</p>
        ) : (
          <div className="grid gap-1.5">
            {workspace.summary.map((row) => (
              <div key={row.code} className="grid grid-cols-[minmax(0,14rem)_1fr_4rem] items-center gap-3 text-sm">
                <span className="truncate">
                  {row.code} {row.label}
                </span>
                <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full bg-primary" style={{ width: `${Math.round((row.hours / maxHours) * 100)}%` }} />
                </div>
                <span className="text-right tabular-nums">{row.hours.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="duty-entries" className="grid gap-2">
        <h2 id="duty-entries" className="text-sm font-semibold">
          Duty log
        </h2>
        {workspace.entries.length === 0 ? (
          <p className="border-t py-4 text-sm text-muted-foreground">Nothing logged yet. Use Log duty, or give a duty to the daily logs below.</p>
        ) : (
          <div className="overflow-x-auto border-t">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Who</th>
                  <th className="py-2 pr-3 font-medium">Duty</th>
                  <th className="py-2 pr-3 text-right font-medium">Hours</th>
                  <th className="py-2 pr-3 font-medium">Notes</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {workspace.entries.map((entry) => {
                  const mine = entry.userId === workspace.currentUserId || workspace.canManage
                  return (
                    <tr key={entry.id} className="border-b align-top">
                      <td className="whitespace-nowrap py-2 pr-3">{formatDate(entry.entryDate)}</td>
                      <td className="py-2 pr-3">{entry.userName}</td>
                      <td className="py-2 pr-3">
                        <span className="font-mono">{entry.dutyCode}</span> {entry.dutyLabel}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{entry.hours !== null ? entry.hours.toFixed(2) : "–"}</td>
                      <td className="py-2 pr-3">
                        {entry.notes}
                        {entry.relatedProjectLabel ? <span className="block text-muted-foreground">For {entry.relatedProjectLabel}</span> : null}
                      </td>
                      <td className="py-2">
                        {workspace.canEdit && mine ? (
                          <div className="flex justify-end gap-1">
                            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => startEdit(entry)}>
                              Edit
                            </Button>
                            <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => remove(entry)}>
                              Delete
                            </Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {workspace.uncategorizedLogs.length > 0 ? (
        <section aria-labelledby="duty-waiting" className="grid gap-2">
          <h2 id="duty-waiting" className="text-sm font-semibold">
            Daily logs waiting for a duty ({workspace.uncategorizedLogs.length})
          </h2>
          <p className="text-sm text-muted-foreground">
            Logs written before the duty log. Give each a duty and hours to count it; the log itself isn&apos;t changed.
          </p>
          <div className="overflow-x-auto border-t">
            <table className="w-full min-w-[640px] text-sm">
              <tbody>
                {workspace.uncategorizedLogs.map((log) => (
                  <tr key={log.id} className="border-b align-top">
                    <td className="whitespace-nowrap py-2 pr-3">{formatDate(log.logDate)}</td>
                    <td className="py-2 pr-3">{log.authorName}</td>
                    <td className="py-2 pr-3">{log.text || <span className="text-muted-foreground">No notes</span>}</td>
                    <td className="py-2 text-right">
                      {workspace.canEdit ? (
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => startFromLog(log)}>
                          Give a duty
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
