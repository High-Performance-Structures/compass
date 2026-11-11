/*
 * Enumerated values for project records (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its columns
 * with them. A company's own job statuses are data (project_job_statuses),
 * not a list here.
 */

/** Department letter a job number starts with. */
export const PROJECT_DEPARTMENTS = ["O", "H", "N", "D"] as const
export type ProjectDepartmentCode = (typeof PROJECT_DEPARTMENTS)[number]

/** Whether the client is still a sales lead or a signed customer. */
export const PROJECT_CLIENT_STATUSES = ["lead", "customer"] as const
export type ProjectClientStatus = (typeof PROJECT_CLIENT_STATUSES)[number]

/** Internal workspace kinds (null for every client project). */
export const WORKSPACE_KINDS = ["office", "executive", "field"] as const
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number]

/** Portfolio map override; "default" follows status and department rules. */
export const PORTFOLIO_MAP_VISIBILITIES = ["default", "shown", "hidden"] as const
export type PortfolioMapVisibility = (typeof PORTFOLIO_MAP_VISIBILITIES)[number]

/**
 * Field app override (0317). A null column means "Automatic": the company's
 * Settings decide from the job's phase and department. Closed jobs never
 * show, whatever the override says.
 */
export const FIELD_APP_VISIBILITIES = ["shown", "hidden"] as const
export type FieldAppVisibility = (typeof FIELD_APP_VISIBILITIES)[number]

/** Result of geocoding the site address. */
export const SITE_LOCATION_STATUSES = ["found", "not_found"] as const

/** Material sales: delivered to the project address, or picked up. */
export const DELIVERY_METHODS = ["delivery", "pickup"] as const
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number]

/** Per-project lodging override for zone charges. */
export const PROJECT_LODGING_CHOICES = ["default", "yes", "no"] as const

/** Outcome of reviewing two possibly duplicate projects. */
export const PROJECT_DUPLICATE_DECISION_STATUSES = ["not_duplicate", "merged"] as const

/** Outcome of reviewing a nonstandard job number. */
export const PROJECT_NUMBER_REVIEW_STATUSES = ["approved_exception"] as const

/**
 * How the owner contract prices the work. Fixed price: changes are
 * renegotiated by change order, so no variances. Cost plus: the builder fee
 * follows every cost movement (variances and change orders). Cost plus fixed
 * fee: the fee changes only with a change order. Null follows the company
 * default in Settings › Workflows › Variances.
 */
export const PROJECT_CONTRACT_TYPES = ["fixed_price", "cost_plus", "cost_plus_fixed_fee"] as const
export type ProjectContractType = (typeof PROJECT_CONTRACT_TYPES)[number]

// Column -> list maps the store checks before every write.
export const PROJECT_LISTS = {
  department: PROJECT_DEPARTMENTS,
  clientStatus: PROJECT_CLIENT_STATUSES,
  workspaceKind: WORKSPACE_KINDS,
  portfolioMapVisibility: PORTFOLIO_MAP_VISIBILITIES,
  fieldAppVisibility: FIELD_APP_VISIBILITIES,
  siteLocationStatus: SITE_LOCATION_STATUSES,
  deliveryMethod: DELIVERY_METHODS,
  contractType: PROJECT_CONTRACT_TYPES,
}
