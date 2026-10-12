import type { ProjectAudienceWorkspaceSection } from "@/lib/project-audience-preview-routes"

export type AudienceQuickLink = {
  readonly label: string
  readonly section: ProjectAudienceWorkspaceSection
}

/**
 * Sections an owner or sub/vendor workspace offers, in display order. Used by
 * the dashboard's quick dock and the map panel so both offer the same
 * permitted destinations.
 */
export function audienceQuickLinks(input: {
  readonly owner: boolean
  readonly warrantyEnabled: boolean
}): readonly AudienceQuickLink[] {
  return [
    { label: input.owner ? "Selections & Decisions" : "Approved selections", section: "selections" },
    ...(input.owner
      ? [
          { label: "Budget / G703", section: "budget" },
          { label: "Owner updates", section: "updates" },
        ] satisfies readonly AudienceQuickLink[]
      : [
          { label: "Respond to RFQs", section: "rfqs" },
          { label: "Commitments", section: "commitments" },
          { label: "RFIs & answers", section: "rfis" },
        ] satisfies readonly AudienceQuickLink[]),
    { label: "Change requests", section: "change-orders" },
    { label: "Project documents", section: "documents" },
    { label: "Project photos", section: "photos" },
    ...(input.owner && input.warrantyEnabled
      ? [{ label: "Warranty requests", section: "warranty" }] satisfies readonly AudienceQuickLink[]
      : []),
  ]
}
