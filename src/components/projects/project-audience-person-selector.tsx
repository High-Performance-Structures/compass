"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { SearchableCombobox } from "@/components/searchable-combobox"
import type { ProjectAudience } from "@/lib/project-audience-access"
import type { ProjectAudiencePreviewPerson } from "@/lib/project-audience-viewer"

export function ProjectAudiencePersonSelector({ options, selectedUserId }: {
  readonly projectId: string
  readonly audience: ProjectAudience
  readonly selectedUserId: string | null
  readonly options: readonly ProjectAudiencePreviewPerson[]
}): React.ReactElement {
  const pathname = usePathname()
  const params = useSearchParams()
  return <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
    <span>Preview as</span>
    <SearchableCombobox
      ariaLabel="Preview as person"
      value={selectedUserId ?? ""}
      options={[{ value: "", label: "Clear person selection", selectedLabel: "Choose an assigned person" }, ...options.map((person) => ({ value: person.id, label: person.invited ? `${person.name} (invited)` : person.name, selectedLabel: `${person.name} · ${person.invited ? "Invited, not accepted" : person.companyName ?? person.email}`, description: [person.companyName, person.email, person.invited ? "Hasn't accepted the invitation yet" : null].filter(Boolean).join(" · ") }))]}
      placeholder="Choose an assigned person"
      searchPlaceholder="Search people or companies"
      disabled={options.length === 0}
      className="h-9 w-full sm:w-80"
      onValueChange={(value) => {
        const next = new URLSearchParams(params.toString())
        if (value) next.set("previewAs", value)
        else next.delete("previewAs")
        // Clear the previous person's entire client state on selection.
        window.location.assign(`${pathname}${next.size ? `?${next}` : ""}`)
      }}
    />
    {options.length === 0 && <span>No owners or vendors invited to this project.</span>}
  </div>
}
