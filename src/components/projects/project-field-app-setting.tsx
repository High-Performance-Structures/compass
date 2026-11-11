"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition, type ReactElement } from "react"

import { updateProjectFieldAppVisibility } from "@/app/actions/project-profile"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { FieldAppChoice } from "@/lib/domain/field/field-app-rules"

/** The three choices, as the Information page and Settings › Workflows › Field app show them. */
export const FIELD_APP_CHOICE_OPTIONS: readonly { readonly value: FieldAppChoice; readonly label: string }[] = [
  { value: "automatic", label: "Automatic" },
  { value: "shown", label: "Always show" },
  { value: "hidden", label: "Hide" },
]

export function fieldAppChoiceOption(value: string): FieldAppChoice | null {
  return FIELD_APP_CHOICE_OPTIONS.find((option) => option.value === value)?.value ?? null
}

/**
 * The job's field app choice on its Information page. One company-wide
 * choice, the same for everyone; saves on its own like the map setting.
 */
export function ProjectFieldAppSetting(props: {
  readonly projectId: string
  readonly choice: FieldAppChoice
  /** Server-written line: whether the job is in the field app now, and why. */
  readonly summary: string
}): ReactElement {
  const router = useRouter()
  const [choice, setChoice] = useState<FieldAppChoice>(props.choice)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="space-y-2">
      <Label htmlFor="field-app-visibility">Field app</Label>
      <Select
        value={choice}
        disabled={pending}
        onValueChange={(value) => {
          const next = fieldAppChoiceOption(value)
          if (!next) return
          const previous = choice
          setChoice(next)
          setError(null)
          startTransition(async () => {
            const result = await updateProjectFieldAppVisibility({ projectId: props.projectId, choice: next })
            if (!result.success) {
              setChoice(previous)
              setError(result.error)
              return
            }
            // The summary line is decided on the server from the company's rules.
            router.refresh()
          })
        }}
      >
        <SelectTrigger id="field-app-visibility" className="h-9 w-full" aria-describedby="field-app-visibility-help">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELD_APP_CHOICE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id="field-app-visibility-help" className="text-xs text-muted-foreground" role="status" aria-live="polite">
        {error ?? (pending ? "Saving…" : props.summary)} Automatic follows Settings → Workflows → Field app.
      </p>
    </div>
  )
}
