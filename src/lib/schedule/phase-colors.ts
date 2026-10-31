import type { ConstructionPhase } from "./types"

export const PHASE_ORDER: ConstructionPhase[] = [
  "preconstruction",
  "sitework",
  "foundation",
  "framing",
  "roofing",
  "electrical",
  "plumbing",
  "hvac",
  "insulation",
  "drywall",
  "finish",
  "landscaping",
  "closeout",
]

export const PHASE_LABELS: Record<ConstructionPhase, string> = {
  preconstruction: "Preconstruction",
  sitework: "Sitework",
  foundation: "Foundation",
  framing: "Framing",
  roofing: "Roofing",
  electrical: "Electrical",
  plumbing: "Plumbing",
  hvac: "HVAC",
  insulation: "Insulation",
  drywall: "Drywall",
  finish: "Finish",
  landscaping: "Landscaping",
  closeout: "Closeout",
}
