import type { ProjectAudience } from "@/lib/project-audience-access"

type AudienceScheduleVisibility = {
  readonly ownerVisible?: boolean | null
  readonly subVendorVisible?: boolean | null
}

/**
 * Initial migrated snapshots predate sub/vendor visibility flags. Preserve
 * their owner-approved rows for partners. Snapshots with explicit flags use
 * the partner selection even when every flag is false.
 */
export function selectProjectAudienceScheduleItems<
  T extends AudienceScheduleVisibility,
>(items: readonly T[], audience: ProjectAudience): readonly T[] {
  if (audience === "owner") {
    return items.filter((item) => item.ownerVisible !== false)
  }

  const isLegacySnapshot = items.some(
    (item) => item.subVendorVisible === undefined || item.subVendorVisible === null
  )
  return items.filter((item) =>
    isLegacySnapshot
      ? item.subVendorVisible === true ||
        (item.subVendorVisible == null && item.ownerVisible !== false)
      : item.subVendorVisible === true
  )
}
