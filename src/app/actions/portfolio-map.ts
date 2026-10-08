"use server"

import { getProjectAudiencePreview } from "@/app/actions/project-audience-preview"
import { vendorJobScope, type VendorJobScope } from "@/lib/portfolio-map/vendor-model"
import { dateKeyInTimeZone } from "@/lib/work-calendar"
import {
  getPortfolioAddableProjects,
  type PortfolioAddableProject,
} from "@/lib/portfolio-map/load"

export type VendorJobScopeResult =
  | { readonly success: true; readonly scope: VendorJobScope }
  | { readonly success: false; readonly error: string }

/** Projects that can be added to the portfolio map (visibility follows getProjects). */
export async function listProjectsToAddToMap(): Promise<readonly PortfolioAddableProject[]> {
  return getPortfolioAddableProjects()
}

/**
 * A sub/vendor's own scope on one job, for the "Your jobs" map panel. Reads
 * through the vendor dashboard's reader, which checks project access and
 * applies the same schedule visibility rules.
 */
export async function getVendorJobScope(projectId: string): Promise<VendorJobScopeResult> {
  try {
    const data = await getProjectAudiencePreview(projectId, "sub_vendor")
    return { success: true, scope: vendorJobScope(data, dateKeyInTimeZone(new Date(), "America/Denver")) }
  } catch {
    return { success: false, error: "This job's scope could not be loaded." }
  }
}
