import type { ProjectAudience } from "@/lib/project-audience-access"

/** What subs and suppliers see of a job's published schedule. */
export type SubScheduleView = "assigned" | "full"

export function isSubScheduleView(value: string): value is SubScheduleView {
  return value === "assigned" || value === "full"
}

type AudienceScheduleVisibility = {
  readonly ownerVisible?: boolean | null
  readonly subVendorVisible?: boolean | null
}

/**
 * Owners see items marked for owners. Subs and suppliers see every published
 * item when the job shows them the full schedule; otherwise the items marked
 * "Subs can view" plus every item they are responsible for, whether or not it
 * is marked (imported jobs arrive with assignments but no marks).
 *
 * Initial migrated snapshots predate sub/vendor visibility flags. Preserve
 * their owner-approved rows for partners. Snapshots with explicit flags use
 * the partner selection even when every flag is false.
 */
export function selectProjectAudienceScheduleItems<
  T extends AudienceScheduleVisibility,
>(
  items: readonly T[],
  audience: ProjectAudience,
  partner: {
    readonly view?: SubScheduleView
    readonly isViewerAssigned?: (item: T) => boolean
  } = {},
): readonly T[] {
  if (audience === "owner") {
    return items.filter((item) => item.ownerVisible !== false)
  }
  if (partner.view === "full") return items
  const assigned = partner.isViewerAssigned ?? (() => false)

  const isLegacySnapshot = items.some(
    (item) => item.subVendorVisible === undefined || item.subVendorVisible === null
  )
  return items.filter((item) =>
    assigned(item) ||
    (isLegacySnapshot
      ? item.subVendorVisible === true ||
        (item.subVendorVisible == null && item.ownerVisible !== false)
      : item.subVendorVisible === true)
  )
}
