"use server"

import {
  getPortfolioAddableProjects,
  type PortfolioAddableProject,
} from "@/lib/portfolio-map/load"

/** Projects that can be added to the portfolio map (visibility follows getProjects). */
export async function listProjectsToAddToMap(): Promise<readonly PortfolioAddableProject[]> {
  return getPortfolioAddableProjects()
}
