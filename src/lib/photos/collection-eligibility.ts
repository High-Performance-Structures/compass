import { sql, type SQL } from "drizzle-orm"

import { dailyLogPhotos } from "@/db/schema"
import { SELECTION_PHOTO_KIND } from "@/lib/photos/review"

/**
 * Collection surfaces should render viewable images, not archive ZIPs,
 * documents, Drive folders, or staged placeholders without media bytes.
 *
 * Selection photos (finish and fixture choices, `photo_kind = 'selection'`)
 * belong to Selections only. Every photo collection outside Selections — the
 * Photos gallery and review, owner and vendor portals, client updates and
 * their pickers, dashboards, field lists, counts and public posts — leaves
 * them out here, by kind. Owner visibility is not enough: selection choices
 * are often owner-visible so owners can see them inside Selections.
 *
 * Direct-ID consumers intentionally bypass this predicate so historical
 * selections and source provenance remain addressable; Selections reads its
 * photos through `project_selection_photos`, never through this predicate.
 */
export function dailyLogPhotoCollectionEligibility(): SQL<boolean> {
  return sql<boolean>`(
    ${dailyLogPhotos.thumbnailUrl} IS NOT NULL
    OR ${dailyLogPhotos.mimeType} LIKE ${"image/%"}
  ) AND (
      ${dailyLogPhotos.driveFileId} IS NOT NULL
      OR ${dailyLogPhotos.thumbnailUrl} IS NOT NULL
    ) AND ${notSelectionPhoto()}`
}

/** Leaves out selection photos; for photo reads that are not image collections (counts, document pickers). */
export function notSelectionPhoto(): SQL<boolean> {
  return sql<boolean>`${dailyLogPhotos.photoKind} IS NOT ${SELECTION_PHOTO_KIND}`
}
