/** Per-project portfolio map override; "default" follows status and department. */
export type PortfolioMapVisibility = "default" | "shown" | "hidden"

export function isPortfolioMapVisibility(value: string): value is PortfolioMapVisibility {
  return value === "default" || value === "shown" || value === "hidden"
}
