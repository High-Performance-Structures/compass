"use client"

import * as React from "react"
import Link from "next/link"
import { createProjectInteraction, type ProjectInteractionFormOptions } from "@/app/actions/project-profile"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { customProjectInteractionType } from "@/lib/project-profile"
import { cn } from "@/lib/utils"

const CUSTOM_TYPE = "__custom__"

function localInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

/**
 * The client-contact record. Nothing is pre-filled: the person logging it
 * chooses who, how, which direction and when, and writes what happened.
 * Only a saved record counts as client contact for project follow-up.
 */
export function ClientInteractionForm({
  projectId,
  options,
  idPrefix,
  onLogged,
  onCancel,
}: {
  readonly projectId: string
  readonly options: ProjectInteractionFormOptions
  readonly idPrefix: string
  readonly onLogged: () => void
  readonly onCancel?: () => void
}): React.ReactElement {
  const [contactId, setContactId] = React.useState("")
  const [type, setType] = React.useState("")
  const [customLabel, setCustomLabel] = React.useState("")
  const [direction, setDirection] = React.useState<"inbound" | "outbound" | "">("")
  const [occurredAt, setOccurredAt] = React.useState("")
  const [summary, setSummary] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const minimum = options.rules.minimumSummaryCharacters
  const summaryLength = summary.trim().length
  const now = new Date()
  const earliest = new Date(now.getTime() - options.rules.maximumBackdateDays * 24 * 60 * 60 * 1000)
  const complete =
    contactId !== "" &&
    type !== "" &&
    (type !== CUSTOM_TYPE || customLabel.trim() !== "") &&
    direction !== "" &&
    occurredAt !== "" &&
    summaryLength >= minimum

  if (options.contacts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This job has no client contact yet.{" "}
        <Link href={`/dashboard/projects/${encodeURIComponent(projectId)}/contacts`} className="text-primary underline-offset-4 hover:underline">
          Add a client contact
        </Link>{" "}
        to log interactions.
      </p>
    )
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setError(null)
    const interactionType = type === CUSTOM_TYPE ? customProjectInteractionType(customLabel) : type
    if (!interactionType) {
      setError("Enter a custom interaction type using 1–60 standard characters.")
      return
    }
    if (direction === "") return
    startTransition(async () => {
      const result = await createProjectInteraction({
        projectId,
        interactionType,
        direction,
        summary,
        occurredAt: new Date(occurredAt).toISOString(),
        contactId,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      onLogged()
    })
  }

  return (
    <form className="grid gap-4" onSubmit={submit} aria-describedby={`${idPrefix}-rules`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-contact`}>Who did you talk with?</Label>
          <SearchableCombobox
            id={`${idPrefix}-contact`}
            className="h-9"
            value={contactId}
            onValueChange={setContactId}
            options={options.contacts.map((contact) => ({ value: contact.id, label: contact.displayName }))}
            ariaLabel="Client contact"
            placeholder="Choose a client contact"
            searchPlaceholder="Search client contacts..."
            emptyMessage="No matching client contacts."
            disabled={pending}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-type`}>How?</Label>
          <SearchableCombobox
            id={`${idPrefix}-type`}
            className="h-9"
            value={type}
            onValueChange={setType}
            options={[
              ...options.interactionTypes.map((option) => ({ value: option.id, label: option.label })),
              { value: CUSTOM_TYPE, label: "Add another interaction type…", keywords: "custom new other" },
            ]}
            ariaLabel="Interaction type"
            placeholder="Call, email, meeting, site visit…"
            searchPlaceholder="Search interaction types..."
            emptyMessage="No matching interaction types."
            disabled={pending}
            required
          />
        </div>
        {type === CUSTOM_TYPE ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${idPrefix}-custom-type`}>Custom interaction type</Label>
            <Input id={`${idPrefix}-custom-type`} value={customLabel} maxLength={60} disabled={pending}
              onChange={(event) => setCustomLabel(event.target.value)} placeholder="For example: Design review" required />
          </div>
        ) : null}
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Who reached out?</legend>
          <div className="flex gap-1" role="radiogroup" aria-label="Direction">
            {([
              { value: "outbound", label: "We contacted them" },
              { value: "inbound", label: "They contacted us" },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={direction === option.value}
                disabled={pending}
                onClick={() => setDirection(option.value)}
                className={cn(
                  "min-h-9 flex-1 rounded-md border px-2 text-sm transition-colors disabled:opacity-50",
                  direction === option.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-when`}>When?</Label>
          <div className="flex gap-2">
            <Input
              id={`${idPrefix}-when`}
              type="datetime-local"
              value={occurredAt}
              min={localInputValue(earliest)}
              max={localInputValue(now)}
              disabled={pending}
              onChange={(event) => setOccurredAt(event.target.value)}
              className="h-9"
              required
            />
            <Button type="button" variant="outline" size="sm" className="h-9" disabled={pending} onClick={() => setOccurredAt(localInputValue(new Date()))}>
              Now
            </Button>
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={`${idPrefix}-summary`}>What happened?</Label>
          <span className={cn("text-xs tabular-nums", summaryLength >= minimum ? "text-muted-foreground" : "text-warning")} aria-live="polite">
            {summaryLength >= minimum ? "✓" : `${minimum - summaryLength} more characters`}
          </span>
        </div>
        <Textarea
          id={`${idPrefix}-summary`}
          value={summary}
          rows={3}
          maxLength={4000}
          disabled={pending}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="Who you spoke with, what was said or sent, and the next step. E.g. Left voicemail for Ted about the revised estimate; will call back Thursday."
          required
        />
      </div>
      <p id={`${idPrefix}-rules`} className="text-xs text-muted-foreground">
        Only a completed record counts as client contact. Snoozing a follow-up does not. Contacts can be backdated up to {options.rules.maximumBackdateDays} days.
      </p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !complete}>{pending ? "Saving…" : "Log interaction"}</Button>
        {onCancel ? <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button> : null}
      </div>
    </form>
  )
}
