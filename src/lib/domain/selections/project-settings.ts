/**
 * The job's company selection settings (Settings › Workflows › Selections),
 * with the defaults when the job has no company.
 */
import { eq } from "drizzle-orm"

import { projects } from "@/db/schema"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import type { SelectionSettings } from "@/lib/feature-settings/selection-settings"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { Db } from "@/lib/server/action-context"

export async function readProjectSelectionSettings(
  db: Db,
  projectId: string,
): Promise<{ readonly organizationId: string | null; readonly settings: SelectionSettings }> {
  const project = await db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, projectId)).get()
  const organizationId = project?.organizationId ?? null
  return {
    organizationId,
    settings: organizationId ? await readFeatureSettings(db, organizationId, "selections") : FEATURE_SETTINGS.selections.defaults,
  }
}
