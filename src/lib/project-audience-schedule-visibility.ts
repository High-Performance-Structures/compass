import type { ProjectAudience } from "@/lib/project-audience-access"

type AudienceScheduleVisibility = {
  readonly ownerVisible: boolean | null | undefined
  readonly subVendorVisible: boolean | null | undefined
}

/**
 * Existing schedules predate sub/vendor visibility flags. Until a project
 * explicitly curates partner-visible tasks, give partners the same published
 * schedule rows already approved for owners. Once any task is explicitly
 * shared with partners, the explicit partner selection becomes authoritative.
 */
export function selectProjectAudienceScheduleItems<
  T extends AudienceScheduleVisibility,
>(items: readonly T[], audience: ProjectAudience): readonly T[] {
  if (audience === "owner") {
    return items.filter((item) => item.ownerVisible !== false)
  }

  const hasExplicitPartnerSelection = items.some(
    (item) => item.subVendorVisible === true
  )
  return items.filter((item) =>
    hasExplicitPartnerSelection
      ? item.subVendorVisible === true
      : item.ownerVisible !== false
  )
}
