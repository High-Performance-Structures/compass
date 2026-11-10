/**
 * Reads a company's selection status labels once on the server so screens
 * and Activity text can pass them down instead of reading settings
 * themselves. See ./status-labels.ts.
 */
import { eq } from "drizzle-orm"

import { projects } from "@/db/schema"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { Db } from "@/lib/server/action-context"

import { DEFAULT_SELECTION_STATUS_LABELS, resolveSelectionStatusLabels, type SelectionStatusLabels } from "./status-labels"

/** The company's label for every selection status (defaults where it renamed nothing). */
export async function readSelectionStatusLabels(db: Db, organizationId: string | null | undefined): Promise<SelectionStatusLabels> {
  if (!organizationId) return DEFAULT_SELECTION_STATUS_LABELS
  const settings = await readFeatureSettings(db, organizationId, "selection-status-names")
  return resolveSelectionStatusLabels(settings.names)
}

/** The labels of the company that owns the project (owner and partner portals read through the job). */
export async function readProjectSelectionStatusLabels(db: Db, projectId: string): Promise<SelectionStatusLabels> {
  const project = await db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, projectId)).get()
  return readSelectionStatusLabels(db, project?.organizationId)
}
