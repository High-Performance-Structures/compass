export const ESTIMATE_WORK_SECTIONS = [
  {
    value: "costs",
    label: "Estimate costs",
    description: "Enter quantities and costs by division or assembly.",
  },
  {
    value: "fees",
    label: "Builder fee & markup",
    description: "Set overhead, margin, contingency, and line markup.",
  },
  {
    value: "report",
    label: "Customer report format",
    description: "Choose the report view and optional cost breakdowns.",
  },
  {
    value: "descriptions",
    label: "Group descriptions & report phases",
    description: "Describe division scopes and customize report phases.",
  },
  {
    value: "text",
    label: "Introduction & closing",
    description: "Choose templates and prepare the customer report wording.",
  },
  {
    value: "contract",
    label: "Contract terms & acknowledgements",
    description: "Review terms and select customer acknowledgements.",
  },
  {
    value: "signers",
    label: "Contract signers",
    description: "Choose the client signers and company representative.",
  },
  {
    value: "approval",
    label: "Approval and accounting handoff",
    description: "Prepare signatures, record acceptance, and hand off the budget.",
  },
  {
    value: "details",
    label: "Estimate details & versions",
    description: "Edit the document details, client, tax entity, and versions.",
  },
  {
    value: "basis",
    label: "Plans, specifications, and estimate basis",
    description: "Link the documents and revisions used for this estimate.",
  },
] as const

export type EstimateWorkSection =
  (typeof ESTIMATE_WORK_SECTIONS)[number]["value"]

export function isEstimateWorkSection(
  value: string
): value is EstimateWorkSection {
  return ESTIMATE_WORK_SECTIONS.some((section) => section.value === value)
}
