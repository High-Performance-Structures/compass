"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  PROJECT_DOCUMENT_AUDIENCES,
  type ProjectDocumentVisibility,
} from "@/lib/project-document-audience"

/**
 * The per-audience "Visible to" checkboxes, shared by the publish form (sets the
 * starting visibility) and each published row (changes it in place). Internal
 * staff always have access, so only the two external audiences are shown.
 */
export function ProjectDocumentVisibilityToggles({
  value,
  onChange,
  disabled = false,
  idPrefix,
}: {
  readonly value: ProjectDocumentVisibility
  readonly onChange: (next: ProjectDocumentVisibility) => void
  readonly disabled?: boolean
  readonly idPrefix: string
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
        Visible to
      </span>
      {PROJECT_DOCUMENT_AUDIENCES.map((option) => {
        const checked = option.value === "owner" ? value.owner : value.subVendor
        const id = `${idPrefix}-${option.value}`
        return (
          <div key={option.value} className="flex items-center gap-1.5">
            <Checkbox
              id={id}
              checked={checked}
              disabled={disabled}
              onCheckedChange={(next) =>
                onChange(
                  option.value === "owner"
                    ? { ...value, owner: next === true }
                    : { ...value, subVendor: next === true }
                )
              }
            />
            <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
              {option.label}
            </Label>
          </div>
        )
      })}
    </div>
  )
}
