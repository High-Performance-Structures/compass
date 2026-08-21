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

const DEFAULT_INTRODUCTION = `Thank you for the opportunity to provide you with an estimate for your project. Please direct any questions to ___________________ at _______________________.`

const HPS_DEFAULT_CLOSING = `General Exclusions: Estimate excludes a construction dumpster and offsite hauling of debris. Should a construction dumpster not be provided by the Owner/Builder, debris shall be consolidated into an area on-site as designated by Owner/Builder but will not be taken offsite.

Material: All material is guaranteed to be as specified. All materials brought to or delivered to the project property by High Performance Structures, inc. is assumed to be property of High Performance Structures, inc. until after completion of final demobilization of High Performance Structures, inc. Owner/builder agrees to pay to High Performance Structures, inc. current market price for any materials tampered with or misappropriated by owner/builder or other subcontractors on the project per the discretion of High Performance Structures, inc.

Concrete Washout: Owner/builder agrees to provide on-site resources and location for concrete washout. If concrete washout is not to be on site owner/builder agrees to pay any and all necessary fees due to offsite concrete washout within scope of work to be completed by High Performance Structures, inc.

Scope of Work: Scope of work for this estimate is based upon Architectural Drawings Drafted by _________ with a drawing date of __________ and Structural Drawings drafted and engineered by _____________ with a drawing date of ____________. Any deviation in work from the scope of work determined in this estimate (including due to but not limited to, changes after construction commencement, site conditions, etc.) will require a new estimate or incur a change order if it takes place during the High Performance Structures, Inc. construction process.

On Site Facilities: Owner/Builder to provide on site restroom facilities prior to the arrival of High Performance Structures, Inc. Crew. If restroom facilities are not onsite prior to the arrival High Performance Structures, inc. crew, owner/builder recognizes this will incur delays and agrees to pay for any man hours incurred due to offsite restroom facilities at a man hour rate of $65/man/hour per the discretion of High Performance Structures, inc.

Site Conditions: Estimate is prepared based upon plan conditions and site conditions discussed with the Owner/Builder. If site conditions differ from plan conditions or those previously discussed with Owner/Builder previously, pricing is subject to change to meet need via change order before or after construction commencement.

On Site Resources: Estimate is prepared under the assumption of on-site electricity and water. Owner/Builder agrees to pay any additional charges incurred as a result of lacking these resources on site including, but not limited to, generator use (fuel, wear, rental, etc.), bringing water on-site, etc.

Safety Conditions: High Performance Structures, Inc. is dedicated to the safety of its team members. Safe job sites also contribute to efficient and precise work, benefiting the Owner/Builder. Owner/Builder agrees that the site will adhere to OSHA safety standards. If OSHA safety standards are not met, Owner/Builder is aware that this may be brought to their attention and will be required by the Owner/Builder to make adjustments in order for High Performance Structures, Inc. to continue working. High Performance Structures, Inc. is not responsible for any delays or additional charges incurred as a result of on-site safety violations.

Pricing: The prices stated in the categories above will remain firm for 30 days after the Print Date above. If performance of this agreement extends beyond this 30-day period, you agree to pay Contractor's then current pricing ("Price") for any Work performed after that 30-day period. The Prices are based only on the terms and conditions expressly stated in this agreement. The Prices exclude any and all terms and conditions not expressly stated herein, including, without limitation, any obligation by Contractor to name you or any third-party as an additional insured on its insurance policy; to provide per project aggregate insurance coverage for the work; to participate in any owner controlled, wrap, or similar insurance program; to indemnify or defend you or any third-party from any claims actions and /or lawsuits of any kind or nature whatsoever. Any terms or conditions required by you by contract or otherwise in addition to or inconsistent with those expressly stated in this agreement will result in additional charge and/or higher Prices. Any additional work performed is subject to Contractor's then current pricing (unless Contractor otherwise agrees in writing) and to this agreement. Contractor will notify owner of any changes in Pricing prior to commencement of work.

All material is guaranteed to be as specified. All work to be completed in a workmanlike manner according to standard practices. Any alteration or deviation from above specifications involving extra costs will become an extra charge over and above the estimate and billed for separate from this original contract. All agreements contingent upon strikes, accidents or delays beyond our control. Client to carry fire, tornado and other necessary insurance. Our workers are fully covered by Workmen's Compensation Insurance.

Payment Terms: 20% Due at contract signing, additional will be billed monthly and due within 10 days after bill is sent. Note: A Finance Charge is charged on any unpaid balance after 30 days from the date of invoice, and is computed by a "Periodic Rate" of 2% per month, which is an ANNUAL PERCENTAGE RATE of 24% applied to the unpaid balance. Client agrees to pay any and all associated attorney fees and legal fees to collect this debt for work completed.

Contractor:
High Performance Structures, Inc. by

________________________________ _______________________
Martine Y. Vogel, President                     Date`

const PLAN_SWIFT_COMPASS_SOURCE_URL =
  "https://drive.google.com/open?id=1Fp_eJ3vevW7wKYmQ4R1G7SUVxHJDbUDC&usp=drive_fs"

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
    id: "builtin:all:default-introduction",
    name: "Default Introductory Text",
    departmentCode: null,
    templateType: "introduction",
    body: DEFAULT_INTRODUCTION,
    sourceDocumentId: null,
    sourceUrl: PLAN_SWIFT_COMPASS_SOURCE_URL,
  },
  {
    id: "builtin:h:default-closing",
    name: "Default HPS Closing Text",
    departmentCode: "H",
    templateType: "closing",
    body: HPS_DEFAULT_CLOSING,
    sourceDocumentId: null,
    sourceUrl: PLAN_SWIFT_COMPASS_SOURCE_URL,
  },
  {
    id: "builtin:o:default-closing",
    name: "Default HPS Closing Text",
    departmentCode: "O",
    templateType: "closing",
    body: HPS_DEFAULT_CLOSING,
    sourceDocumentId: null,
    sourceUrl: PLAN_SWIFT_COMPASS_SOURCE_URL,
  },
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

export function estimateTextTemplateIdentity(
  template: Pick<
    EstimateTextTemplateOption,
    "departmentCode" | "templateType" | "name"
  >
): string {
  return [
    template.departmentCode ?? "all",
    template.templateType,
    template.name.trim().toLocaleLowerCase(),
  ].join(":")
}

export function mergeEstimateTextTemplates(input: {
  readonly organizationTemplates: readonly EstimateTextTemplateOption[]
  readonly builtInTemplates: readonly EstimateTextTemplateOption[]
}): readonly EstimateTextTemplateOption[] {
  const organizationKeys = new Set(
    input.organizationTemplates.map(estimateTextTemplateIdentity)
  )
  return [
    ...input.organizationTemplates,
    ...input.builtInTemplates.filter(
      (template) => !organizationKeys.has(estimateTextTemplateIdentity(template))
    ),
  ]
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
