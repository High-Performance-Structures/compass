import { z } from "zod/v4"
import { DAILY_LOG_OPTIONAL_FIELDS } from "@/lib/daily-logs/daily-log-form"
import { DEFAULT_LABOR_CODE_DEPARTMENTS, DEFAULT_LABOR_COST_CODES } from "@/lib/daily-logs/labor-cost-codes"
import { DAILY_LOG_TODO_MODES, DAILY_LOG_TODO_TYPES } from "@/lib/daily-logs/log-followups"
import { PROJECT_TIMELINE_KINDS } from "@/lib/project-timeline/model"
import { DAILY_LOG_REMINDER_AUDIENCES, TIME_PATTERN } from "@/lib/daily-logs/reminders"
import {
  DEFAULT_CLIENT_FOLLOW_UP_SETTINGS,
  clientFollowUpSettingsSchema,
  type ClientFollowUpSettings,
} from "@/lib/client-follow-up/leaderboard"
import { DEFAULT_DEPARTMENT_PROFILES } from "@/lib/department-profiles"
import { PORTFOLIO_DEPARTMENT_VIEWS, PORTFOLIO_PHASE_IDS } from "@/lib/portfolio-map/phases"
import { ESTIMATE_MODES } from "@/lib/estimates/estimate-modes"
import { PAY_APPLICATION_OWNER_DETAILS } from "@/lib/financials/pay-application-detail"

/**
 * Company-editable feature settings. Each feature registers one group with
 * its defaults and validation; stored values are merged over the defaults so
 * new fields get sensible values automatically.
 */

export const messageDeskSettingsSchema = z
  .object({
    firstResponseDays: z.number().min(0.25).max(30),
    agingDays: z.number().min(0.5).max(60),
    staleDays: z.number().min(1).max(90),
    remindOnStale: z.boolean(),
  })
  .refine((value) => value.agingDays < value.staleDays, {
    message: "Stale must be longer than Aging.",
    path: ["staleDays"],
  })

/**
 * Portfolio map: which job statuses appear and in which pipeline phase, and
 * which departments appear. Only changes from the built-in mapping are stored;
 * "off" keeps a status off the map. A job's own Show/Hide still wins.
 */
export const portfolioMapSettingsSchema = z.object({
  statusPhases: z.record(z.string().min(1).max(80), z.enum([...PORTFOLIO_PHASE_IDS, "off"])),
  /** Per-department view (projects, sales pipeline, internal, off); missing uses the default. */
  departmentViews: z.record(z.string().min(1).max(8), z.enum(PORTFOLIO_DEPARTMENT_VIEWS)),
  /** Sales pipeline titles by department; blank uses the built-in title. */
  salesTitles: z.record(z.string().min(1).max(8), z.string().max(60)),
})

export type PortfolioMapSettings = z.infer<typeof portfolioMapSettingsSchema>

/**
 * Estimates: per department, one contract estimate per job or several at
 * once. Only departments that differ from the built-in mode are stored.
 */
export const estimateSettingsSchema = z.object({
  modes: z.record(z.string().regex(/^[A-Z]$/), z.enum(ESTIMATE_MODES)),
  /**
   * Line markup (percent) given to items copied into a job of this
   * department from another job's estimate. A department without one keeps
   * the source markup.
   */
  copyMarkupPercents: z.record(z.string().regex(/^[A-Z]$/), z.number().min(0).max(1000)).optional(),
})

export type EstimateSettings = z.infer<typeof estimateSettingsSchema>

/**
 * Linked job shortcuts: common work a customer asks for that belongs to
 * another department (pour help on a Nu-Tech job → an HPS job). Any job can
 * create a linked job in any department; shortcuts pre-fill the department
 * and the list of work to choose from.
 */
export const linkedJobShortcutSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  /** Department of the job it's offered on; "*" for every department. */
  fromDepartment: z.string().regex(/^([A-Z]|\*)$/),
  toDepartment: z.string().regex(/^[A-Z]$/),
  workItems: z.array(z.string().trim().min(1).max(80)).max(12),
})

export const linkedJobSettingsSchema = z.object({
  shortcuts: z.array(linkedJobShortcutSchema).max(30),
})

export type LinkedJobShortcut = z.infer<typeof linkedJobShortcutSchema>
export type LinkedJobSettings = z.infer<typeof linkedJobSettingsSchema>

/**
 * Square and Sage payments: who gets Square alerts. Empty lists keep the
 * defaults (connection alerts to the configured developer, payment problems
 * to administrators).
 */
export const squarePaymentSettingsSchema = z.object({
  connectionAlertUserIds: z.array(z.string().min(1).max(200)).max(20),
  paymentAlertUserIds: z.array(z.string().min(1).max(200)).max(20),
  /** Sage login of whoever creates invoices → their Compass person. */
  sageUserMappings: z
    .array(z.object({ sageUsername: z.string().trim().min(1).max(100), userId: z.string().min(1).max(200) }))
    .max(50),
  /** Also reminded about every unentered receipt; empty = the payment alert people. */
  receiptReminderUserIds: z.array(z.string().min(1).max(200)).max(20),
  /** Hours between reminders while a receipt isn't in Sage; 0 turns reminders off. */
  receiptReminderHours: z.number().int().min(0).max(168),
  receiptReminderBusinessHoursOnly: z.boolean(),
  timeZone: z.string().min(1).max(64),
})

export type SquarePaymentSettings = z.infer<typeof squarePaymentSettingsSchema>

export type MessageDeskSettings = z.infer<typeof messageDeskSettingsSchema>

/** One job status's client follow-up thresholds, in business days since the last client contact. */
export const projectFollowUpThresholdsSchema = z
  .object({
    dueDays: z.number().int().min(1).max(60),
    overdueDays: z.number().int().min(2).max(120),
  })
  .refine((value) => value.dueDays < value.overdueDays, {
    message: "Overdue must be longer than Follow-up due.",
    path: ["overdueDays"],
  })

/**
 * Project aging: per-status follow-up thresholds that replace the status's
 * built-in cadence. Statuses left out use their cadence (due on the cadence
 * day, overdue the day after).
 */
export const projectAgingSettingsSchema = z.object({
  statuses: z.record(z.string().min(1).max(80), projectFollowUpThresholdsSchema),
  /** Remind a job's follow-up owner when it turns overdue (missing means yes). */
  remindOnOverdue: z.boolean().optional(),
  /**
   * When jobs with no logged contact started aging (ISO time, recorded when the
   * company turns this on). Missing means those jobs stay "No contact logged".
   */
  noContactClockStart: z.string().datetime().optional(),
  /**
   * Per-department fallback follow-up owner (user id), used when a job has no
   * owner and no logged contact. Keyed by department code.
   */
  defaultOwners: z.record(z.string().regex(/^[OHND]$/), z.string().min(1).max(200)).optional(),
})

export type ProjectAgingSettings = z.infer<typeof projectAgingSettingsSchema>

const optionalEmail = z.union([z.literal(""), z.email()])

/**
 * Nu-Tech (material sales) emails: the mailbox they are sent from, the outside
 * parties' details the templates fill in, and per-template text that replaces
 * the built-in wording. Blank values leave the matching merge field empty.
 */
export const nuTechEmailSettingsSchema = z.object({
  /** The block manufacturer's name, used as the vendor on its purchase orders. */
  manufacturerName: z.string().max(80),
  /** The manufacturer's vendor number in the accounting system, when known. */
  manufacturerVendorId: z.string().max(40),
  manufacturerOrdersEmail: optionalEmail,
  manufacturerCcEmail: optionalEmail,
  dealerAccountNumber: z.string().max(40),
  warehouseName: z.string().max(80),
  warehouseAddress: z.string().max(160),
  warehousePhone: z.string().max(40),
  warehouseEmail: optionalEmail,
  warehouseDockHours: z.string().max(80),
  /** Sales tax district for customer pickups at the warehouse. */
  warehouseTaxEntityId: z.string().max(80),
  /** Cost code for catalog products without their own (estimates and POs). */
  productCostCode: z.string().max(20),
  /** Cost code for the shipping charge on estimates. */
  shippingCostCode: z.string().max(20),
  /** The manufacturer's order form (Google Drive link or file ID, Sheet or .xlsx) the PO workbook is filled from. */
  orderFormFile: z.string().max(300),
  /** FOB wording on the order form for deliveries and for customer pickups. */
  fobDelivery: z.string().max(80),
  fobPickup: z.string().max(80),
  /** Lowest number for the next manufacturer PO; each order takes one higher than the last Compass assigned. */
  nextPurchaseOrderNumber: z.string().regex(/^\d{0,9}$/, "Use digits only"),
  templates: z.record(
    z.string().min(1).max(60),
    z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(8000) }),
  ),
})

export type NuTechEmailSettings = z.infer<typeof nuTechEmailSettingsSchema>
/**
 * Project paper trail: readable copies of Compass records in each project's
 * Drive folder. "pilot" limits saving to the listed projects while the
 * company checks the results.
 */
export const paperTrailSettingsSchema = z.object({
  mode: z.enum(["off", "pilot", "on"]),
  pilotProjectIds: z.array(z.string().min(1).max(80)).max(50),
  purchaseOrders: z.boolean(),
  estimates: z.boolean(),
  rfis: z.boolean(),
  changeOrders: z.boolean(),
  shopTickets: z.boolean(),
  milestoneCopies: z.boolean(),
  quietMinutes: z.number().int().min(1).max(60),
  /**
   * Email domains, and specific trusted addresses (e.g. an owner's personal
   * Gmail), that count as inside the company when checking whether a Drive
   * folder is shared. The connected Google account's domain always counts.
   */
  internalDomains: z
    .array(z.string().min(3).max(120).regex(/^([a-z0-9._%+-]+@)?[a-z0-9.-]+\.[a-z]{2,}$/))
    .max(60),
})

export type PaperTrailSettings = z.infer<typeof paperTrailSettingsSchema>

/**
 * My Compass calendar: a Google calendar in each staff member's account with
 * the Compass items assigned to them, kept current every few minutes.
 */
export const myCompassCalendarSettingsSchema = z.object({
  mode: z.enum(["off", "pilot", "on"]),
  pilotUserIds: z.array(z.string().min(1).max(80)).max(50),
  scheduleItems: z.boolean(),
  todos: z.boolean(),
  projectMilestones: z.boolean(),
  daysBack: z.number().int().min(0).max(60),
  daysAhead: z.number().int().min(14).max(365),
})

export type MyCompassCalendarSettings = z.infer<typeof myCompassCalendarSettingsSchema>

/** Settings type for each registered feature key. */
const LOGO_DATA_URL = /^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i

/**
 * Duplicate project check: departments whose customers place repeat orders,
 * each its own job and number. Their jobs aren't flagged as duplicates just
 * for sharing a customer and name.
 */
export const projectDuplicateSettingsSchema = z.object({
  repeatOrderDepartments: z.array(z.enum(["O", "H", "N", "D"])).max(4),
})

export type ProjectDuplicateSettings = z.infer<typeof projectDuplicateSettingsSchema>

/** One department's identity; see DepartmentProfile in src/lib/department-profiles.ts. */
export const departmentProfileSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a display name.").max(80),
  shortName: z.string().trim().min(1, "Enter a short name.").max(24),
  description: z.string().max(200),
  companyName: z.string().trim().min(1, "Enter a company name.").max(120),
  legalName: z.string().trim().min(1, "Enter the legal name.").max(200),
  email: optionalEmail,
  telephone: z.string().max(40),
  mailingAddress: z.string().max(240),
  website: z.string().max(200),
  licenseNumber: z.string().max(60),
  officeHours: z.string().max(80),
  senderAddress: optionalEmail,
  senderName: z.string().max(80),
  logoDataUrl: z
    .string()
    .max(400_000, "Use a PNG logo under 300 KB.")
    .refine((value) => value === "" || LOGO_DATA_URL.test(value), "Use a PNG logo."),
})

export const departmentProfilesSchema = z.object({
  departments: z.object({
    O: departmentProfileSchema,
    H: departmentProfileSchema,
    N: departmentProfileSchema,
    D: departmentProfileSchema,
  }),
})

export type DepartmentProfilesSettings = z.infer<typeof departmentProfilesSchema>

/** A company's changes to one workflow step; see WorkflowStepOverride in src/lib/job-workflows/engine.ts. */
export const workflowStepOverrideSchema = z.object({
  label: z.string().trim().max(60).optional(),
  hidden: z.boolean().optional(),
  jobStatusId: z.string().min(1).max(80).nullable().optional(),
  items: z
    .record(
      z.string().min(1).max(60),
      z.object({ label: z.string().trim().max(160).optional(), hidden: z.boolean().optional() }),
    )
    .optional(),
  extraItems: z
    .array(
      z.object({
        id: z.string().regex(/^custom-[a-z0-9-]{1,40}$/),
        label: z.string().trim().min(1, "Enter the checklist item.").max(160),
      }),
    )
    .max(20)
    .optional(),
})

const workflowOverridesSchema = z.record(z.string().min(1).max(60), workflowStepOverrideSchema)

const workflowStepOrderSchema = z.array(z.string().min(1).max(60)).max(60)

/** A step the company added; its checklist lives in the step's extraItems. */
export const workflowCustomStepSchema = z.object({
  id: z.string().regex(/^custom-[a-z0-9-]{1,40}$/),
  label: z.string().trim().min(1, "Name the step.").max(60),
  jobStatusId: z.string().min(1).max(80).nullable(),
})

const workflowCustomStepsSchema = z.array(workflowCustomStepSchema).max(20)

/**
 * Job workflows, per department: changes to each step (departments), the
 * company's step order, and steps the company added.
 */
export const jobWorkflowsSettingsSchema = z.object({
  departments: z.object({
    O: workflowOverridesSchema.optional(),
    H: workflowOverridesSchema.optional(),
    N: workflowOverridesSchema.optional(),
    D: workflowOverridesSchema.optional(),
  }),
  order: z.object({
    O: workflowStepOrderSchema.optional(),
    H: workflowStepOrderSchema.optional(),
    N: workflowStepOrderSchema.optional(),
    D: workflowStepOrderSchema.optional(),
  }),
  customSteps: z.object({
    O: workflowCustomStepsSchema.optional(),
    H: workflowCustomStepsSchema.optional(),
    N: workflowCustomStepsSchema.optional(),
    D: workflowCustomStepsSchema.optional(),
  }),
})

export type JobWorkflowsSettings = z.infer<typeof jobWorkflowsSettingsSchema>

export const clientInteractionSettingsSchema = z.object({
  /** A logged contact needs at least this much written about what happened. */
  minimumSummaryCharacters: z.number().int().min(1).max(500),
  /** How far back a contact may be dated. */
  maximumBackdateDays: z.number().int().min(1).max(365),
})

export type ClientInteractionSettings = z.infer<typeof clientInteractionSettingsSchema>

/** HPS, ORC and Design job emails: per-template wording, keyed `${department}.${templateId}`. */
export const jobEmailSettingsSchema = z.object({
  templates: z.record(
    z.string().regex(/^[OHND]\.[a-z0-9_]{1,60}$/),
    z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(8000) }),
  ),
})

export type JobEmailSettings = z.infer<typeof jobEmailSettingsSchema>

/**
 * Shop tickets bill a project for the company's own labor and machine hours.
 * The issuing department's profile supplies the letterhead.
 */
export const shopTicketSettingsSchema = z.object({
  numberPrefix: z.string().trim().max(12).regex(/^[A-Za-z0-9-]*$/, "Use letters, numbers or dashes."),
  /** The first number to use; later tickets continue from the highest issued. */
  startNumber: z.number().int().min(1).max(999_999),
  issuingDepartment: z.enum(["O", "H", "N", "D"]),
  title: z.string().trim().min(1).max(40),
  subtitle: z.string().trim().max(80),
})

export type ShopTicketSettings = z.infer<typeof shopTicketSettingsSchema>

/**
 * Nu-Tech bracing rentals: the equipment and sizes on the rental form, how
 * many the company owns (for availability), the daily rate per brace, and
 * what is required before equipment goes out.
 */
export const bracingRentalSettingsSchema = z.object({
  dailyRateCents: z.number().int().min(0).max(100_000),
  /** The item whose count is the number of braces billed per day. */
  billedItemKey: z.string().min(1).max(40),
  sizes: z.array(z.string().trim().min(1).max(20)).max(8),
  items: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9_]{1,40}$/),
        label: z.string().trim().min(1, "Name the item.").max(60),
        /** Owned, by size ("" when the item has no size). */
        owned: z.record(z.string().max(20), z.number().int().min(0).max(100_000)),
      }),
    )
    .min(1)
    .max(30),
  minDepositPercent: z.number().int().min(0).max(100),
  requireIdCopy: z.boolean(),
})

export type BracingRentalSettings = z.infer<typeof bracingRentalSettingsSchema>

/**
 * Duties for internal workspaces. Each is a cost code (the company's Sage
 * codes by default) so logged hours line up with how payroll is coded.
 */
export const internalDutySettingsSchema = z.object({
  duties: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(20),
        label: z.string().trim().min(1).max(80),
        workspace: z.enum(["office", "field"]),
        active: z.boolean(),
        /** Offered in Field Mode; unset means field duties yes, office duties no. */
        onPhones: z.boolean().optional(),
      }),
    )
    .max(80),
})

export type InternalDutySettings = z.infer<typeof internalDutySettingsSchema>

/** The Internal department: the Project Hub tab that lists internal workspaces. */
export const internalDepartmentSettingsSchema = z.object({
  name: z.string().trim().min(1, "Enter a name for the Internal department.").max(24),
  description: z.string().trim().max(200),
})

export type InternalDepartmentSettings = z.infer<typeof internalDepartmentSettingsSchema>

/**
 * Daily logs: what every log must include before it can be saved, beyond the
 * date and the work completed. The same rules apply in the browser and in
 * Field Mode on phones.
 */
export const dailyLogSettingsSchema = z.object({
  /** At least one cost code with its time. */
  requireCostCodeTime: z.boolean(),
  requiredFields: z.array(z.enum(DAILY_LOG_OPTIONAL_FIELDS)).max(DAILY_LOG_OPTIONAL_FIELDS.length),
  /** The labor cost codes job daily logs choose from (Sage Time & Attendance). */
  laborCostCodes: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(20),
        payrollId: z.string().trim().max(20),
        name: z.string().trim().min(1).max(80),
        active: z.boolean(),
      }),
    )
    .max(300),
  /** Departments whose jobs use the labor list; other jobs list every company cost code. */
  laborCodeDepartments: z.array(z.enum(["O", "H", "N", "D"])).max(4),
})

export type DailyLogSettings = z.infer<typeof dailyLogSettingsSchema>

/** How daily logs create and update to-dos and record client contact. */
export const dailyLogFollowUpSettingsSchema = z.object({
  /** Issue and next-step lines: the crew flags them ("ask"), every line ("auto") or none ("off"). */
  todoMode: z.enum(DAILY_LOG_TODO_MODES),
  /** To-do kinds the crew may create from a log. */
  todoTypes: z.array(z.enum(DAILY_LOG_TODO_TYPES)).max(DAILY_LOG_TODO_TYPES.length),
  /** Ticking an Open to-do on a log moves it to In progress. */
  workedMovesToInProgress: z.boolean(),
  /** Blocked to-dos ask "still blocked?" on the next log. */
  carryBlocked: z.boolean(),
  /** To-dos carry a cost code. */
  todoCostCodes: z.boolean(),
  /** Ticking a to-do with a cost code adds a cost code line for its hours. */
  tickAddsLine: z.boolean(),
  /** The crew picks the cost code on a new to-do; off leaves it to the office. */
  crewPicksCostCode: z.boolean(),
  /** Ask "Is it finished?" once a to-do was worked on in this many logs and is still open. */
  finishNudgeAfterLogs: z.number().int().min(1).max(30),
  /** Show "Client contact" on daily logs. */
  clientContact: z.boolean(),
  /** Suggest it when Visitors names a client contact. */
  clientContactSuggest: z.boolean(),
})

export type DailyLogFollowUpSettings = z.infer<typeof dailyLogFollowUpSettingsSchema>

/** What a job's Overview timeline shows. */
export const projectTimelineSettingsSchema = z.object({
  kinds: z.array(z.enum(PROJECT_TIMELINE_KINDS)).max(PROJECT_TIMELINE_KINDS.length),
  /** Days shown at first; "Show earlier" adds this many more. */
  days: z.number().int().min(3).max(60),
})

export type ProjectTimelineSettings = z.infer<typeof projectTimelineSettingsSchema>

/** Reminding staff who haven't written a daily log by the end of the day. */
export const dailyLogReminderSettingsSchema = z.object({
  enabled: z.boolean(),
  audience: z.enum(DAILY_LOG_REMINDER_AUDIENCES),
  officeTime: z.string().regex(TIME_PATTERN, "Enter a time like 16:30."),
  fieldTime: z.string().regex(TIME_PATTERN, "Enter a time like 16:30."),
  /** Days people are expected to log, 0 = Sunday. */
  workDays: z.array(z.number().int().min(0).max(6)).max(7),
  /** Skip someone on an Absence on the work calendar. */
  skipAbsences: z.boolean(),
  /** The next morning, list who is still missing in Office alerts and on admins' dashboards. */
  adminMissingList: z.boolean(),
  /** Each person may set their own time in their preferences. */
  staffPickOwnTime: z.boolean(),
})

export type DailyLogReminderSettings = z.infer<typeof dailyLogReminderSettingsSchema>

/**
 * Schedule conflicts: when the same crew or company is booked on two jobs over
 * the same days. Names here are never flagged (a company with several crews),
 * and aliases treat another spelling as the same name.
 */
export const scheduleConflictSettingsSchema = z.object({
  ignoredParties: z.array(z.string().trim().min(1).max(120)).max(100),
  aliases: z
    .array(z.object({ from: z.string().trim().min(1).max(120), to: z.string().trim().min(1).max(120) }))
    .max(200),
})

export type ScheduleConflictSettingsValue = z.infer<typeof scheduleConflictSettingsSchema>

/** Contract packets: which optional documents new packets leave out by default. */
export const contractPacketSettingsSchema = z.object({
  /** Template codes left unchecked when a new packet is created. */
  excludedByDefault: z.array(z.string().min(1).max(40)).max(200),
})

export type ContractPacketSettings = z.infer<typeof contractPacketSettingsSchema>

/** Contract deposits: how a received deposit reaches pay applications. */
export const contractDepositSettingsSchema = z.object({
  /** New pay applications apply the unapplied deposit balance automatically. */
  autoApplyToPayApplications: z.boolean(),
})

export type ContractDepositSettings = z.infer<typeof contractDepositSettingsSchema>

export const payApplicationSettingsSchema = z.object({
  /** What the client sees on a pay application unless the draw overrides it. */
  ownerDetail: z.enum(PAY_APPLICATION_OWNER_DETAILS),
})

export type PayApplicationSettings = z.infer<typeof payApplicationSettingsSchema>

type FeatureSettingsTypes = {
  readonly "contract-deposits": ContractDepositSettings
  readonly "contract-packets": ContractPacketSettings
  readonly "pay-applications": PayApplicationSettings
  readonly "schedule-conflicts": ScheduleConflictSettingsValue
  readonly "daily-logs": DailyLogSettings
  readonly "daily-log-followups": DailyLogFollowUpSettings
  readonly "project-timeline": ProjectTimelineSettings
  readonly "daily-log-reminders": DailyLogReminderSettings
  readonly "internal-duties": InternalDutySettings
  readonly "internal-department": InternalDepartmentSettings
  readonly "client-interactions": ClientInteractionSettings
  readonly "client-follow-up": ClientFollowUpSettings
  readonly "department-profiles": DepartmentProfilesSettings
  readonly "message-desk": MessageDeskSettings
  readonly "project-aging": ProjectAgingSettings
  readonly "nutech-emails": NuTechEmailSettings
  readonly "paper-trail": PaperTrailSettings
  readonly "my-compass-calendar": MyCompassCalendarSettings
  readonly "job-workflows": JobWorkflowsSettings
  readonly "job-emails": JobEmailSettings
  readonly "shop-tickets": ShopTicketSettings
  readonly "bracing-rentals": BracingRentalSettings
  readonly "project-duplicates": ProjectDuplicateSettings
  readonly "linked-jobs": LinkedJobSettings
  readonly "square-payments": SquarePaymentSettings
  readonly "portfolio-map": PortfolioMapSettings
  readonly estimates: EstimateSettings
}

type FeatureSettingsGroup<T> = {
  readonly label: string
  readonly description: string
  readonly defaults: T
  readonly schema: z.ZodType<T>
  /** Roles that may edit this group; defaults to admins and secondary admins. */
  readonly editorRoles?: ReadonlySet<string>
}

export type FeatureSettingsKey = keyof FeatureSettingsTypes
export type FeatureSettingsValue<K extends FeatureSettingsKey> = FeatureSettingsTypes[K]

export const FEATURE_SETTINGS: { readonly [K in FeatureSettingsKey]: FeatureSettingsGroup<FeatureSettingsTypes[K]> } = {
  "schedule-conflicts": {
    label: "Schedule conflicts",
    description: "Flags a crew or company booked on two jobs over the same days. List names to never flag, and other spellings of the same name.",
    defaults: { ignoredParties: [], aliases: [] },
    schema: scheduleConflictSettingsSchema,
  },
  "daily-logs": {
    label: "Daily logs",
    description: "What every daily log must include before it saves, in the browser and in Field Mode.",
    defaults: {
      requireCostCodeTime: true,
      requiredFields: [],
      laborCostCodes: [...DEFAULT_LABOR_COST_CODES],
      laborCodeDepartments: [...DEFAULT_LABOR_CODE_DEPARTMENTS],
    },
    schema: dailyLogSettingsSchema,
  },
  "daily-log-followups": {
    label: "Daily log to-dos and client contact",
    description: "How daily logs create and update to-dos and record client contact, in the browser and in Field Mode.",
    defaults: {
      todoMode: "ask",
      todoTypes: [...DAILY_LOG_TODO_TYPES],
      workedMovesToInProgress: true,
      carryBlocked: true,
      todoCostCodes: true,
      tickAddsLine: true,
      crewPicksCostCode: true,
      finishNudgeAfterLogs: 3,
      clientContact: true,
      clientContactSuggest: true,
    },
    schema: dailyLogFollowUpSettingsSchema,
  },
  "project-timeline": {
    label: "Project timeline",
    description: "What each job's Overview shows under What's happening: daily logs, to-dos, client contact, office time, machine hours and schedule changes.",
    defaults: {
      kinds: [...PROJECT_TIMELINE_KINDS],
      days: 14,
    },
    schema: projectTimelineSettingsSchema,
  },
  "daily-log-reminders": {
    label: "Daily log reminders",
    description: "Remind staff who haven't written a daily log today, on a job or in their workspace. Clients, subs and suppliers never get it.",
    defaults: {
      enabled: true,
      audience: "all_staff",
      officeTime: "16:30",
      fieldTime: "16:30",
      workDays: [1, 2, 3, 4, 5],
      skipAbsences: true,
      adminMissingList: true,
      staffPickOwnTime: false,
    },
    schema: dailyLogReminderSettingsSchema,
  },
  "internal-duties": {
    label: "Internal duties",
    description: "The duties staff log in internal workspaces (H-Office, the yard). Each duty is a cost code so hours match how payroll is coded.",
    defaults: {
      duties: [
        { code: "501", label: "Sales Taxes", workspace: "office", active: true },
        { code: "502", label: "Bank Reconciliations", workspace: "office", active: true },
        { code: "503", label: "General Accounting & Bookkeeping", workspace: "office", active: true },
        { code: "504", label: "Audits and Compliance", workspace: "office", active: true },
        { code: "505", label: "Payroll", workspace: "office", active: true },
        { code: "506", label: "Marketing/Social Media", workspace: "office", active: true },
        { code: "507", label: "Billing/Accounts Receivable", workspace: "office", active: true },
        { code: "508", label: "Business Development", workspace: "office", active: true },
        { code: "509", label: "Education and Training", workspace: "office", active: true },
        { code: "510", label: "Legal", workspace: "office", active: true },
        { code: "511", label: "Managerial Accounting", workspace: "office", active: true },
        { code: "512", label: "Accounts Payable", workspace: "office", active: true },
        { code: "513", label: "Office Housekeeping/Maintenance", workspace: "office", active: true },
        { code: "514", label: "Human Resources Development", workspace: "office", active: true },
        { code: "41", label: "New Lead Communications", workspace: "office", active: true },
        { code: "42", label: "Planning & Administration", workspace: "office", active: true },
        { code: "43", label: "Takeoffs and Estimates", workspace: "office", active: true },
        { code: "32", label: "Administrative Fee", workspace: "office", active: true },
        { code: "1540007", label: "ICF Bracing Rental", workspace: "field", active: true },
        { code: "01 71 13", label: "Mobilization", workspace: "field", active: true },
        { code: "10800000", label: "Miscellaneous Costs", workspace: "field", active: true },
      ],
    },
    schema: internalDutySettingsSchema,
  },
  "internal-department": {
    label: "Internal department",
    description: "The name of the department that holds internal workspaces: the office, the owner's office and yards.",
    defaults: { name: "Internal", description: "Office, owner's office and yard workspaces." },
    schema: internalDepartmentSettingsSchema,
  },
  "contract-deposits": {
    label: "Contract deposits",
    description: "Whether new pay applications automatically apply the contract deposit that hasn't been applied yet. Staff can change the amount on any draft pay application.",
    defaults: { autoApplyToPayApplications: true },
    schema: contractDepositSettingsSchema,
  },
  "pay-applications": {
    label: "Pay applications",
    description: "How much detail the client sees on a pay application. Staff can choose a different level on any draw.",
    defaults: { ownerDetail: "division_percent" },
    schema: payApplicationSettingsSchema,
  },
  "contract-packets": {
    label: "Contract packets",
    description: "Which optional contract documents a new contract packet includes by default. The agreement and the estimate are always included.",
    defaults: { excludedByDefault: [] },
    schema: contractPacketSettingsSchema,
  },
  "client-follow-up": {
    label: "Client follow-up page",
    description: "How the Client follow-up page shows team activity: the leaderboard, streaks and the period it opens on.",
    defaults: DEFAULT_CLIENT_FOLLOW_UP_SETTINGS,
    schema: clientFollowUpSettingsSchema,
  },
  "project-duplicates": {
    label: "Duplicate project check",
    description: "Departments whose customers place repeat orders. Their separate orders aren't flagged as duplicates just for having the same customer.",
    defaults: { repeatOrderDepartments: ["N"] },
    schema: projectDuplicateSettingsSchema,
  },
  "client-interactions": {
    label: "Client contact records",
    description: "What a logged client contact must include before it counts toward project follow-up.",
    defaults: { minimumSummaryCharacters: 15, maximumBackdateDays: 30 },
    schema: clientInteractionSettingsSchema,
  },
  "department-profiles": {
    label: "Departments",
    description: "Each department's name, legal name, logo and contact details. Documents, emails, portals and print views read them from here.",
    defaults: { departments: DEFAULT_DEPARTMENT_PROFILES },
    schema: departmentProfilesSchema,
    // Company identity is the owner's to change.
    editorRoles: new Set(["admin"]),
  },
  "message-desk": {
    label: "Staff Message Desk",
    description: "When open messages are flagged for follow-up, counted in business days.",
    defaults: { firstResponseDays: 1, agingDays: 2, staleDays: 5, remindOnStale: true },
    schema: messageDeskSettingsSchema,
  },
  "project-aging": {
    label: "Project aging",
    description: "When a job's client follow-up is due or overdue, by job status, counted in business days since the last client contact.",
    defaults: { statuses: {} },
    schema: projectAgingSettingsSchema,
  },
  "nutech-emails": {
    label: "Nu-Tech emails",
    description: "The manufacturer, warehouse and dealer details Nu-Tech order emails and purchase orders fill in, and each template's wording. The sending mailbox, phone and hours come from the Nu-Tech department profile.",
    defaults: {
      manufacturerName: "",
      manufacturerVendorId: "",
      manufacturerOrdersEmail: "",
      manufacturerCcEmail: "",
      dealerAccountNumber: "",
      warehouseName: "",
      warehouseAddress: "",
      warehousePhone: "",
      warehouseEmail: "",
      warehouseDockHours: "",
      warehouseTaxEntityId: "",
      productCostCode: "",
      shippingCostCode: "",
      orderFormFile: "",
      fobDelivery: "",
      fobPickup: "",
      nextPurchaseOrderNumber: "",
      templates: {},
    },
    schema: nuTechEmailSettingsSchema,
  },
  estimates: {
    label: "Estimates",
    description: "Per department: one contract estimate per job (it becomes the budget; changes go through change orders), or several estimates at once, each accepted on its own; and the markup for items copied in from another job's estimate.",
    defaults: { modes: {} },
    schema: estimateSettingsSchema,
  },
  "square-payments": {
    label: "Square and Sage payments",
    description: "Who is alerted about the Square connection and about Square payments that need attention in Sage.",
    defaults: {
      connectionAlertUserIds: [],
      paymentAlertUserIds: [],
      sageUserMappings: [],
      receiptReminderUserIds: [],
      receiptReminderHours: 24,
      receiptReminderBusinessHoursOnly: true,
      timeZone: "America/Denver",
    },
    schema: squarePaymentSettingsSchema,
  },
  "linked-jobs": {
    label: "Linked jobs",
    description: "Shortcuts for creating a linked job in another department for the same customer and site, such as pour help or stacking on a material sale.",
    defaults: {
      shortcuts: [
        { id: "pour-help", label: "Pour help or stacking", fromDepartment: "N", toDepartment: "H", workItems: ["Pour help", "Stacking ICF block", "Bracing setup and removal"] },
        { id: "full-build", label: "Full build", fromDepartment: "H", toDepartment: "O", workItems: [] },
        { id: "block-order", label: "ICF block order", fromDepartment: "D", toDepartment: "N", workItems: [] },
      ],
    },
    schema: linkedJobSettingsSchema,
  },
  "portfolio-map": {
    label: "Portfolio map",
    description: "Which view each department's jobs appear on (projects, a sales pipeline, internal, or none), which job statuses appear and in which phase. Any single job can still be shown or hidden from the map.",
    defaults: { statusPhases: {}, departmentViews: {}, salesTitles: {} },
    schema: portfolioMapSettingsSchema,
  },
  "paper-trail": {
    label: "Project paper trail",
    description: "Which Compass records are saved as PDFs in each project's Google Drive folder, and how long to wait after the last edit.",
    defaults: {
      mode: "off",
      pilotProjectIds: [],
      purchaseOrders: true,
      estimates: true,
      rfis: true,
      changeOrders: true,
      shopTickets: true,
      milestoneCopies: true,
      quietMinutes: 3,
      internalDomains: [],
    },
    schema: paperTrailSettingsSchema,
  },
  "my-compass-calendar": {
    label: "My Compass calendar",
    description: "A Google calendar in each staff member's account with the schedule items and to-dos assigned to them.",
    defaults: {
      mode: "off",
      pilotUserIds: [],
      scheduleItems: true,
      todos: true,
      projectMilestones: true,
      daysBack: 14,
      daysAhead: 120,
    },
    schema: myCompassCalendarSettingsSchema,
  },
  "job-workflows": {
    label: "Job workflows",
    description: "The steps and checklists on each department's job overview. Reorder, rename or hide steps, add your own steps and checklist items, and choose the job status each step goes with.",
    defaults: { departments: {}, order: {}, customSteps: {} },
    schema: jobWorkflowsSettingsSchema,
  },
  "job-emails": {
    label: "Job emails",
    description: "The emails offered on HPS, ORC and Design job overviews. Company names, phone and address come from Settings → Company; edit any template's wording here.",
    defaults: { templates: {} },
    schema: jobEmailSettingsSchema,
  },
  "shop-tickets": {
    label: "Shop tickets",
    description: "Numbering and letterhead for shop tickets that bill a project for labor and machine hours at the rate book's set rates.",
    defaults: {
      numberPrefix: "GSL",
      startNumber: 176,
      issuingDepartment: "H",
      title: "Shop Ticket",
      subtitle: "Labor and Machine Hours",
    },
    schema: shopTicketSettingsSchema,
  },
  "bracing-rentals": {
    label: "Bracing rentals",
    description: "The rental equipment and sizes, how many you own, the daily rate per brace, and what's needed before bracing goes out.",
    defaults: {
      dailyRateCents: 400,
      billedItemKey: "strongback_channel",
      sizes: ["9 ft", "10 ft", "12 ft", "Tall"],
      items: [
        { key: "turnbuckle", label: "7-11 Turnbuckle", owned: {} },
        { key: "strongback_channel", label: "Strongback Channel", owned: {} },
        { key: "platform_bracket", label: "Platform Bracket", owned: {} },
        { key: "guardrail_post", label: "Guardrail Post", owned: {} },
        { key: "platform_pin", label: "9/16 x 6 Platform Pin", owned: {} },
        { key: "safety_pin", label: "Safety Pin", owned: {} },
        { key: "tall_wall_turnbuckle", label: "Tall Wall Turnbuckle", owned: {} },
        { key: "strongback_coupler", label: "Strongback Coupler", owned: {} },
      ],
      minDepositPercent: 50,
      requireIdCopy: true,
    },
    schema: bracingRentalSettingsSchema,
  },
}

export function isFeatureSettingsKey(value: string): value is FeatureSettingsKey {
  return Object.prototype.hasOwnProperty.call(FEATURE_SETTINGS, value)
}

/** Stored JSON merged over the defaults; invalid or missing values fall back. */
export function parseFeatureSettings<K extends FeatureSettingsKey>(key: K, raw: string | null | undefined): FeatureSettingsValue<K> {
  const group = FEATURE_SETTINGS[key]
  if (!raw) return group.defaults
  try {
    const parsed: unknown = JSON.parse(raw)
    const merged = typeof parsed === "object" && parsed !== null ? { ...group.defaults, ...parsed } : group.defaults
    const result = group.schema.safeParse(merged)
    return result.success ? result.data : group.defaults
  } catch {
    return group.defaults
  }
}

/** Roles that may change company settings. */
const FEATURE_SETTINGS_EDITOR_ROLES: ReadonlySet<string> = new Set(["admin", "secondary_admin"])

export function canEditFeatureSettings(role: string, key?: FeatureSettingsKey): boolean {
  const roles = key ? (FEATURE_SETTINGS[key].editorRoles ?? FEATURE_SETTINGS_EDITOR_ROLES) : FEATURE_SETTINGS_EDITOR_ROLES
  return roles.has(role)
}
