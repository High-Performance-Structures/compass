"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  getProjectInteractionFormOptions,
  snoozeProjectFollowUp,
  type ProjectInteractionFormOptions,
} from "@/app/actions/project-profile"
import { ClientInteractionForm } from "@/components/projects/client-interaction-form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PROJECT_AGING_LEVELS, type ProjectAgingLevel, type ProjectFollowUpSignal } from "@/lib/project-follow-up"

export function agingColor(level: ProjectAgingLevel): string {
  return `var(${PROJECT_AGING_LEVELS[level].colorToken})`
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

/** "Last contact 4 business days ago", or why there is no count. */
export function followUpSummary(signal: ProjectFollowUpSignal): string {
  if (signal.businessDaysSinceLastTouch === null) return "No client contact logged yet"
  if (signal.businessDaysSinceLastTouch === 0) return "Last client contact today"
  return `Last client contact ${plural(signal.businessDaysSinceLastTouch, "business day")} ago`
}

function shortDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** Compact level chip for cards and lists; only due and overdue jobs get one. */
export function FollowUpChip({ signal }: { readonly signal: ProjectFollowUpSignal | null }): React.ReactElement | null {
  if (!signal || (signal.level !== "due" && signal.level !== "overdue")) return null
  const days = signal.businessDaysSinceLastTouch
  return (
    <span
      className="shrink-0 border px-1 font-mono text-xs tracking-[0.08em]"
      style={{ borderColor: agingColor(signal.level), color: agingColor(signal.level) }}
      title={followUpSummary(signal)}
    >
      {signal.level === "overdue" ? "OVERDUE" : "DUE"}
      {days === null ? "" : ` · ${days}D`}
    </span>
  )
}

/** Next morning `days` calendar days out, 8:00 local. */
function snoozeDate(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(8, 0, 0, 0)
  return date.toISOString()
}

const SNOOZE_OPTIONS: readonly { readonly label: string; readonly days: number }[] = [
  { label: "Tomorrow", days: 1 },
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
]

type FormOptionsState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly options: ProjectInteractionFormOptions }
  | { readonly kind: "error"; readonly error: string }

/**
 * A job's follow-up aging with its actions: log a client interaction (a full
 * record of who, how, when and what happened, which resets the clock) or
 * snooze the follow-up (which does not count as contact). Shared by the map
 * panels, job pages and the project's follow-up tracker.
 */
type FollowUpSectionProps = {
  readonly projectId: string
  readonly signal: ProjectFollowUpSignal
  /** Map panel layout: thresholds in one line, history link instead of the form's extras. */
  readonly compact?: boolean
}

export function FollowUpSection(props: FollowUpSectionProps): React.ReactElement {
  // Keep cached contacts, drafts and pending loads owned by one project.
  return <ProjectFollowUpSection key={props.projectId} {...props} />
}

function ProjectFollowUpSection({
  projectId,
  signal,
  compact = false,
}: FollowUpSectionProps): React.ReactElement {
  const router = useRouter()
  const [mode, setMode] = React.useState<"none" | "snooze">("none")
  const [logOpen, setLogOpen] = React.useState(false)
  const [formOptions, setFormOptions] = React.useState<FormOptionsState>({ kind: "idle" })
  const [formKey, setFormKey] = React.useState(0)
  const [message, setMessage] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const level = PROJECT_AGING_LEVELS[signal.level]

  const openLog = (): void => {
    setMessage(null)
    setMode("none")
    setLogOpen(true)
    if (formOptions.kind === "ready" || formOptions.kind === "loading") return
    setFormOptions({ kind: "loading" })
    void getProjectInteractionFormOptions(projectId).then((result) => {
      setFormOptions(result.success ? { kind: "ready", options: result.options } : { kind: "error", error: result.error })
    })
  }

  const snooze = (days: number): void => {
    setMessage(null)
    startTransition(async () => {
      const result = await snoozeProjectFollowUp({ projectId, nextFollowUpAt: snoozeDate(days) })
      if (!result.success) {
        setMessage(result.error)
        return
      }
      setMode("none")
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* The project page's section already has the heading. */}
        {compact ? <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground">CLIENT FOLLOW-UP</span> : null}
        <span
          className="border px-1.5 py-0.5 font-mono text-xs tracking-[0.1em]"
          style={{ borderColor: agingColor(signal.level), color: agingColor(signal.level) }}
        >
          {level.label.toUpperCase()}
        </span>
      </div>
      <p className="text-sm">{followUpSummary(signal)}</p>
      <p className="text-xs text-muted-foreground">
        {signal.nextFollowUpAt && signal.level === "scheduled" ? `Next follow-up ${shortDate(signal.nextFollowUpAt)} · ` : ""}
        Due after {plural(signal.thresholds.dueDays, "business day")}, overdue after {signal.thresholds.overdueDays}
        {compact ? null : " (set per status in Settings → Workflows)"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={openLog}>
          Log contact
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "snooze" ? "default" : "outline"}
          disabled={pending}
          onClick={() => setMode(mode === "snooze" ? "none" : "snooze")}
        >
          Snooze
        </Button>
        {compact ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/dashboard/projects/${encodeURIComponent(projectId)}/information#client-follow-up`}>History</Link>
          </Button>
        ) : null}
        {compact ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/dashboard/client-follow-up?job=${encodeURIComponent(projectId)}`}>Client follow-up</Link>
          </Button>
        ) : null}
      </div>
      {mode === "snooze" ? (
        <div role="group" aria-label="Snooze follow-up" className="flex flex-wrap gap-1">
          {SNOOZE_OPTIONS.map((option) => (
            <button
              key={option.days}
              type="button"
              disabled={pending}
              onClick={() => snooze(option.days)}
              className="min-h-7 border border-border px-2 text-xs transition-colors hover:bg-accent disabled:opacity-50"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Log client interaction</DialogTitle>
            <DialogDescription>
              Record who you talked with, how, when and what happened. Only a completed record counts as client contact.
            </DialogDescription>
          </DialogHeader>
          {formOptions.kind === "ready" ? (
            <ClientInteractionForm
              key={formKey}
              projectId={projectId}
              idPrefix={`follow-up-${projectId}`}
              options={formOptions.options}
              onCancel={() => setLogOpen(false)}
              onLogged={() => {
                setLogOpen(false)
                setFormKey((value) => value + 1)
                router.refresh()
              }}
            />
          ) : formOptions.kind === "error" ? (
            <p role="alert" className="text-sm text-destructive">{formOptions.error}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Loading client contacts…</p>
          )}
        </DialogContent>
      </Dialog>
      {message ? <p role="alert" className="text-xs text-destructive">{message}</p> : null}
    </div>
  )
}
