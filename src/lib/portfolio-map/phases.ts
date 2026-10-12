/**
 * The map's pipeline phases and which job statuses fall in each by default.
 * Kept free of map data so settings can import it.
 */
export const PORTFOLIO_PHASES = [
  { id: "intake", label: "Intake", short: "INT" },
  { id: "design", label: "Design", short: "DES" },
  { id: "estimating", label: "Estimating", short: "EST" },
  { id: "negotiation", label: "Negotiation", short: "NEG" },
  { id: "permitting", label: "Permitting", short: "PER" },
  { id: "construction", label: "Under construction", short: "BLD" },
  { id: "closeout", label: "Closeout", short: "CLO" },
] as const

export type PortfolioPhaseId = (typeof PORTFOLIO_PHASES)[number]["id"]

export const PORTFOLIO_PHASE_IDS: readonly [PortfolioPhaseId, ...PortfolioPhaseId[]] = [
  "intake",
  "design",
  "estimating",
  "negotiation",
  "permitting",
  "construction",
  "closeout",
]

/**
 * Built-in phases by job status. Closeout covers punch list and warranty
 * work. Statuses not listed stay off the map unless a company maps them in
 * Settings: complete, closed, refused, inactive, internal, and the material
 * order statuses.
 */
export const DEFAULT_PHASE_BY_JOB_STATUS: Readonly<Record<string, PortfolioPhaseId>> = {
  // Intake: first contact and new-client info, before any design or pricing.
  intake: "intake",
  new_client_info_sent: "intake",
  budget_estimating: "estimating",
  budget_estimate_sent: "estimating",
  estimating: "estimating",
  estimate_sent: "estimating",
  awaiting_response: "estimating",
  follow_up: "estimating",
  takeoff: "estimating",
  design_proposal: "design",
  design_proposal_sent: "design",
  design_proposal_signed: "design",
  in_design: "design",
  engineering: "design",
  value_engineering: "design",
  // Negotiation: reviewing, drafting, sending or revising the contract, until
  // it is awarded and funded.
  contract_docs: "negotiation",
  contract_docs_sent: "negotiation",
  contract_docs_signed: "negotiation",
  contract: "negotiation",
  awarded: "negotiation",
  awaiting_funding: "negotiation",
  permitting: "permitting",
  // Permit in hand, waiting to start.
  awaiting_groundbreaking: "permitting",
  bracing_out: "construction",
  under_construction: "construction",
  current: "construction",
  punchlist: "closeout",
  under_warranty: "closeout",
}

/**
 * Where a department's jobs appear on the dashboard map: with the projects
 * (construction pipeline), on its own sales pipeline view, on the Internal
 * view, or not at all.
 */
export const PORTFOLIO_DEPARTMENT_VIEWS = ["projects", "sales", "internal", "off"] as const
export type PortfolioDepartmentView = (typeof PORTFOLIO_DEPARTMENT_VIEWS)[number]

/** Built-in views: Nu-Tech (material sales) has its own sales pipeline; others are projects. */
export const DEFAULT_DEPARTMENT_VIEWS: Readonly<Record<string, PortfolioDepartmentView>> = { N: "sales" }

/** A company's changes to the built-in mapping (Settings → Portfolio map). */
export type PortfolioMapRules = {
  readonly statusPhases: Readonly<Record<string, PortfolioPhaseId | "off">>
  readonly departmentViews: Readonly<Record<string, PortfolioDepartmentView>>
  /** Titles for sales pipeline views, by department; blank uses the built-in title. */
  readonly salesTitles: Readonly<Record<string, string>>
}

export const DEFAULT_PORTFOLIO_MAP_RULES: PortfolioMapRules = { statusPhases: {}, departmentViews: {}, salesTitles: {} }

/** The view a department's jobs appear on; jobs without a department are projects. */
export function departmentView(department: string | null, rules: PortfolioMapRules): PortfolioDepartmentView {
  if (!department) return "projects"
  return rules.departmentViews[department] ?? DEFAULT_DEPARTMENT_VIEWS[department] ?? "projects"
}
