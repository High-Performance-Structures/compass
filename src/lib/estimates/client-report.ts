import type { ProjectDepartment } from "@/lib/project-branding"

export const ESTIMATE_TEXT_TEMPLATE_TYPES = [
  "terms",
  "introduction",
  "closing",
  "acknowledgement",
] as const

export type EstimateTextTemplateType =
  (typeof ESTIMATE_TEXT_TEMPLATE_TYPES)[number]

export type EstimateClientReportMode =
  | "phase_summary"
  | "ca22"
  | "cost_code"

export type EstimateTextTemplateOption = {
  readonly id: string
  readonly name: string
  readonly departmentCode: ProjectDepartment | null
  readonly templateType: EstimateTextTemplateType
  readonly body: string
  readonly sourceDocumentId: string | null
  readonly sourceUrl: string | null
}

export type ClientEstimateLine = {
  readonly id: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly costCode: string
  readonly description: string
  readonly specifications: string | null
  readonly lineTotalCents: number
  readonly ownerVisible: boolean
  readonly sortOrder: number
}

export type ClientEstimatePhase = {
  readonly divisionCode: string
  readonly divisionName: string
  readonly description: string
  readonly subtotalCents: number
  readonly lines: readonly ClientEstimateLine[]
}

const TAKEOFF_ACKNOWLEDGEMENT = `Thank you for choosing Nu-Tech Systems as your distributor and for granting us the opportunity to provide an estimate and takeoff services. We are happy to provide those takeoff services as preliminary quantities. The final takeoffs, however, must be determined by the installation contractor, especially considering external factors such as site conditions, final heights based on site conditions, installation, waste factors, etc. Please review and initial the following terms of takeoff services:

I acknowledge that I have reviewed the height verifications sent from Nu-Tech Systems and verified that the heights in their respective locations with corresponding block sizes are correct. Initial: _______

I acknowledge that I received notice for adding any waste margin, and either requested or denied procuring extra bundles for potential waste. Initial: _______

I acknowledge that I have reviewed the final quantities in the takeoffs and approve those quantities. Initial: _______

I understand that I am solely responsible as the installing contractor for the final quantities of the takeoffs. Initial: _______

I acknowledge that I am responsible for counting the inventory of block picked up or delivered by Fox Blocks. Initial: _______

I acknowledge that if I need any additional quantities after the initial order, Nu-Tech Systems will need a minimum of 2 days' notice, pending availability. I also acknowledge that additional block may not be readily available. Initial: _______

Takeoff Disclaimer: Nu-Tech Systems is not responsible for final quantities. Responsibility for final quantities is solely that of the installing contractor. All sales final.

With this knowledge, I ____________________________ (Printed Name) accept and acknowledge the takeoff terms outlined herein.

Client Signature: __________________________________________ Date: ________________

Nu-Tech Signature: ________________________________________ Date: ________________`

const CONSULTATION_INDEMNIFICATION = `The consultation advice given by High Performance Structures, Inc. consists of suggestions from installation experience, but does not take the place of advice or inspections from engineers or building departments. All consultation advice is information about best practices and standards and should not be construed as approval from an engineer. Thus, in seeking consultation advice, there is recognition and acknowledgement of this Indemnification Agreement:

The Indemnifying Party agrees to indemnify and hold the Indemnified Party harmless from and against any and all claims, liability, loss, expenses, suits, damages, judgments, demands, and costs (including reasonable legal fees and expenses) arising out of (i) the acts or omissions of the Indemnifying Party; or (ii) any accident, injury or death to persons, or loss of or damage to property, or fines and penalties which may result, in whole or in part, by reason of description except to the extent that such damage is due solely and directly to the negligence of the Indemnified Party.

With this knowledge, I _______________________________ (Printed Name) accept the policies outlined herein as a condition of consultation.

Client Signature: __________________________________________ Date: ________________

Contractor Signature: ______________________________________ Date: ________________`

export const BUILT_IN_ESTIMATE_TEXT_TEMPLATES: readonly EstimateTextTemplateOption[] = [
  {
    id: "builtin:n:takeoff-acknowledgement",
    name: "Takeoff Acknowledgement",
    departmentCode: "N",
    templateType: "acknowledgement",
    body: TAKEOFF_ACKNOWLEDGEMENT,
    sourceDocumentId: "16WWC1527X__He1_bo0CDT8FC0hWpajj3",
    sourceUrl:
      "https://docs.google.com/document/d/16WWC1527X__He1_bo0CDT8FC0hWpajj3/edit",
  },
  {
    id: "builtin:n:consultation-indemnification",
    name: "Consultation and Indemnification Agreement",
    departmentCode: "N",
    templateType: "acknowledgement",
    body: CONSULTATION_INDEMNIFICATION,
    sourceDocumentId: "1E3J6YWvOxWP0EoMpV9H7IxLN03icacE7",
    sourceUrl:
      "https://docs.google.com/document/d/1E3J6YWvOxWP0EoMpV9H7IxLN03icacE7/edit",
  },
]

export function isEstimateTextTemplateType(
  value: string
): value is EstimateTextTemplateType {
  return ESTIMATE_TEXT_TEMPLATE_TYPES.some((type) => type === value)
}

export function estimateClientReportMode(
  department: ProjectDepartment
): EstimateClientReportMode {
  if (department === "H") return "phase_summary"
  if (department === "N") return "cost_code"
  return "ca22"
}

export function defaultEstimateTitle(
  department: ProjectDepartment
): string {
  if (department === "H") return "Construction Estimate"
  if (department === "N") return "Material Estimate"
  return "CA22 Construction Estimate"
}

export function estimateTitleForDepartment(input: {
  readonly department: ProjectDepartment
  readonly requestedTitle: string | null
}): string {
  const requestedTitle = input.requestedTitle?.trim() ?? ""
  if (
    requestedTitle.length === 0 ||
    (input.department !== "O" &&
      requestedTitle === "CA22 Construction Estimate")
  ) {
    return defaultEstimateTitle(input.department)
  }
  return requestedTitle
}

export function builtInEstimateTextTemplates(input: {
  readonly department: ProjectDepartment
  readonly templateType?: EstimateTextTemplateType
}): readonly EstimateTextTemplateOption[] {
  return BUILT_IN_ESTIMATE_TEXT_TEMPLATES.filter(
    (template) =>
      (template.departmentCode === null ||
        template.departmentCode === input.department) &&
      (!input.templateType || template.templateType === input.templateType)
  )
}

export function clientEstimatePhases(input: {
  readonly lines: readonly ClientEstimateLine[]
  readonly phaseDescriptions: Readonly<Record<string, string>>
}): readonly ClientEstimatePhase[] {
  const groups = new Map<string, ClientEstimateLine[]>()
  for (const line of input.lines) {
    if (!line.ownerVisible) continue
    const current = groups.get(line.divisionCode) ?? []
    current.push(line)
    groups.set(line.divisionCode, current)
  }

  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([divisionCode, sourceLines]) => {
      const lines = [...sourceLines].sort((left, right) => {
        const sortOrder = left.sortOrder - right.sortOrder
        if (sortOrder !== 0) return sortOrder
        return left.costCode.localeCompare(right.costCode)
      })
      const divisionName = lines[0]?.divisionName ?? `Phase ${divisionCode}`
      const customDescription = input.phaseDescriptions[divisionCode]?.trim()
      return {
        divisionCode,
        divisionName,
        description:
          customDescription && customDescription.length > 0
            ? customDescription
            : divisionName,
        subtotalCents: lines.reduce(
          (total, line) => total + line.lineTotalCents,
          0
        ),
        lines,
      }
    })
}
