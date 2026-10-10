"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createProjectInteraction, getProjectQuickLogContacts, snoozeProjectFollowUp } from "@/app/actions/project-profile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { PROJECT_AGING_LEVELS, type ProjectAgingLevel, type ProjectFollowUpSignal } from "@/lib/project-follow-up"
import { PROJECT_INTERACTION_TYPE_DEFINITIONS } from "@/lib/project-profile"
import { cn } from "@/lib/utils"

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

const QUICK_TYPES = PROJECT_INTERACTION_TYPE_DEFINITIONS.filter((type) => type.id !== "client_send")

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

type ContactsState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly contacts: readonly { readonly id: string; readonly displayName: string }[] }
  | { readonly kind: "error"; readonly error: string }

/**
 * A job's follow-up aging with one-click actions: log a client contact (which
 * resets the clock and lands in the project's interaction history) or snooze
 * the follow-up. Shared by the map panels and the project's follow-up tracker.
 */
export function FollowUpSection({
  projectId,
  signal,
  compact = false,
}: {
  readonly projectId: string
  readonly signal: ProjectFollowUpSignal
  /** Map panel layout: thresholds in one line, history link instead of the form's extras. */
  readonly compact?: boolean
}): React.ReactElement {
  const router = useRouter()
  const [mode, setMode] = React.useState<"none" | "log" | "snooze">("none")
  const [contacts, setContacts] = React.useState<ContactsState>({ kind: "idle" })
  const [contactId, setContactId] = React.useState("")
  const [type, setType] = React.useState<string>("call")
  const [summary, setSummary] = React.useState("")
  const [message, setMessage] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const level = PROJECT_AGING_LEVELS[signal.level]

  const openLog = (): void => {
    setMode(mode === "log" ? "none" : "log")
    setMessage(null)
    if (contacts.kind !== "idle") return
    setContacts({ kind: "loading" })
    void getProjectQuickLogContacts(projectId).then((result) => {
      if (!result.success) {
        setContacts({ kind: "error", error: result.error })
        return
      }
      setContacts({ kind: "ready", contacts: result.contacts })
      setContactId(result.contacts[0]?.id ?? "")
    })
  }

  const log = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setMessage(null)
    startTransition(async () => {
      const result = await createProjectInteraction({
        projectId,
        interactionType: type,
        direction: "outbound",
        summary,
        occurredAt: new Date().toISOString(),
        contactId: contactId || null,
      })
      if (!result.success) {
        setMessage(result.error)
        return
      }
      setSummary("")
      setMode("none")
      router.refresh()
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
        <Button type="button" size="sm" variant={mode === "log" ? "default" : "outline"} disabled={pending} onClick={openLog}>
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
      {mode === "log" ? (
        contacts.kind === "loading" || contacts.kind === "idle" ? (
          <p className="text-xs text-muted-foreground">Loading client contacts…</p>
        ) : contacts.kind === "error" ? (
          <p role="alert" className="text-xs text-destructive">{contacts.error}</p>
        ) : contacts.contacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            This job has no client contact yet.{" "}
            <Link
              href={`/dashboard/projects/${encodeURIComponent(projectId)}/contacts`}
              className="text-primary underline-offset-4 hover:underline"
            >
              Add one
            </Link>{" "}
            to log contacts.
          </p>
        ) : (
          <form className="flex flex-col gap-2" onSubmit={log}>
            <div role="group" aria-label="Contact type" className="flex flex-wrap gap-1">
              {QUICK_TYPES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={type === option.id}
                  onClick={() => setType(option.id)}
                  className={cn(
                    "min-h-7 border border-border px-2 text-xs transition-colors",
                    type === option.id ? "bg-foreground text-background" : "hover:bg-accent",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {contacts.contacts.length > 1 ? (
              <SearchableCombobox
                className="h-8 text-xs"
                value={contactId}
                onValueChange={setContactId}
                options={contacts.contacts.map((contact) => ({ value: contact.id, label: contact.displayName }))}
                ariaLabel="Client contact"
                placeholder="Choose a client contact"
                searchPlaceholder="Search client contacts..."
                emptyMessage="No matching client contacts."
              />
            ) : (
              <span className="text-xs text-muted-foreground">With {contacts.contacts[0]?.displayName}</span>
            )}
            <Input
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="What happened? (left voicemail, sent revised estimate…)"
              aria-label="Contact summary"
              className="h-8 text-xs"
              required
            />
            <Button type="submit" size="sm" disabled={pending || summary.trim().length === 0}>
              Log {QUICK_TYPES.find((option) => option.id === type)?.label.toLowerCase() ?? "contact"}
            </Button>
          </form>
        )
      ) : null}
      {message ? <p role="alert" className="text-xs text-destructive">{message}</p> : null}
    </div>
  )
}
