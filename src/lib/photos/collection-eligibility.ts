import { sql, type SQL } from "drizzle-orm"

import { dailyLogPhotos } from "@/db/schema"

/**
 * Collection surfaces should render viewable images, not archive ZIPs,
 * documents, Drive folders, or staged placeholders without media bytes.
 * Direct-ID consumers intentionally bypass this predicate so historical
 * selections and source provenance remain addressable.
 */
export function dailyLogPhotoCollectionEligibility(): SQL<boolean> {
  return sql<boolean>`(
    ${dailyLogPhotos.thumbnailUrl} IS NOT NULL
    OR ${dailyLogPhotos.mimeType} LIKE ${"image/%"}
  ) AND (
      ${dailyLogPhotos.driveFileId} IS NOT NULL
      OR ${dailyLogPhotos.thumbnailUrl} IS NOT NULL
    )`
}
