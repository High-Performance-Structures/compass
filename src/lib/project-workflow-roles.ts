export type ProjectWorkflowRoleId =
  | "admin-owner"
  | "project-manager"
  | "assistant-project-manager"
  | "project-administrator"
  | "field-superintendent"
  | "field-crew"
  | "design-estimating"
  | "office-manager"

export type ProjectWorkspaceMode = "worker" | "developer"

export type WorkflowStepId =
  | "context"
  | "schedule"
  | "contacts"
  | "field"
  | "rfqs"
  | "purchase-orders"
  | "owner-update"
  | "bills-draws"
  | "budget"
  | "intake"

export type RoleLens = {
  readonly id: ProjectWorkflowRoleId
  readonly label: string
  readonly badge: string
  readonly detail: string
  readonly focus: string
  readonly priority: readonly WorkflowStepId[]
}

export const PROJECT_MANAGER_ROLE_LENS: RoleLens = {
  id: "project-manager",
  label: "Project manager",
  badge: "Coordinate",
  detail:
    "Coordinates PM, APM, field superintendent, schedule, decisions, and blockers.",
  focus:
    "Lead the daily operating loop: schedule, decisions, procurement, field reality, and owner readiness.",
  priority: [
    "schedule",
    "rfqs",
    "purchase-orders",
    "contacts",
    "field",
    "owner-update",
    "budget",
    "bills-draws",
    "intake",
    "context",
  ],
}

export const PROJECT_WORKFLOW_ROLE_LENSES: readonly RoleLens[] = [
  {
    id: "admin-owner",
    label: "Admin-owner",
    badge: "Worker mode",
    detail:
      "Worker mode by default, developer mode when buildout controls are needed.",
    focus:
      "Use Compass as an operator first, with explicit developer mode for registry, integration, and buildout controls.",
    priority: [
      "schedule",
      "contacts",
      "field",
      "owner-update",
      "budget",
      "rfqs",
      "purchase-orders",
      "bills-draws",
      "intake",
      "context",
    ],
  },
  PROJECT_MANAGER_ROLE_LENS,
  {
    id: "assistant-project-manager",
    label: "Assistant PM",
    badge: "Process",
    detail:
      "Updates schedules, processes POs, RFIs/RFQs, and estimate takeoffs.",
    focus:
      "Keep the machinery moving: schedule updates, RFIs/RFQs, POs, contacts, and estimate support.",
    priority: [
      "schedule",
      "purchase-orders",
      "rfqs",
      "contacts",
      "budget",
      "intake",
      "field",
      "owner-update",
      "bills-draws",
      "context",
    ],
  },
  {
    id: "project-administrator",
    label: "Project administrator",
    badge: "Owner comms",
    detail:
      "Owner communication, weekly updates, vendor bills, and monthly draws.",
    focus:
      "Turn approved field input into owner communication, billing readiness, and clean monthly draws.",
    priority: [
      "owner-update",
      "bills-draws",
      "budget",
      "field",
      "contacts",
      "schedule",
      "intake",
      "purchase-orders",
      "rfqs",
      "context",
    ],
  },
  {
    id: "field-superintendent",
    label: "Field superintendent",
    badge: "Field",
    detail:
      "Deliveries, onsite issues, field schedule, and PM/APM communication.",
    focus:
      "See what is happening next on site, what needs a decision, and what field input needs review.",
    priority: [
      "field",
      "schedule",
      "rfqs",
      "intake",
      "contacts",
      "purchase-orders",
      "owner-update",
      "budget",
      "bills-draws",
      "context",
    ],
  },
  {
    id: "field-crew",
    label: "Field crew",
    badge: "Capture",
    detail: "Daily progress, challenges, needs, photos, and field notes.",
    focus:
      "Make daily capture simple: photos, progress, blockers, needs, and the next schedule items.",
    priority: [
      "field",
      "intake",
      "schedule",
      "rfqs",
      "contacts",
      "purchase-orders",
      "owner-update",
      "budget",
      "bills-draws",
      "context",
    ],
  },
  {
    id: "design-estimating",
    label: "Design / estimating",
    badge: "Scope",
    detail: "Designer, drafter, lead estimator, and assistant estimator views.",
    focus:
      "Surface design questions, scopes, takeoffs, budget detail, and cost-code alignment.",
    priority: [
      "rfqs",
      "budget",
      "contacts",
      "schedule",
      "field",
      "purchase-orders",
      "intake",
      "owner-update",
      "bills-draws",
      "context",
    ],
  },
  {
    id: "office-manager",
    label: "Office manager",
    badge: "Admin",
    detail:
      "Internal admin work, possibly through a separate internal project/dashboard.",
    focus:
      "Support contact cleanup, bills, owner communication, and internal admin work without forcing everything through a client job.",
    priority: [
      "contacts",
      "bills-draws",
      "owner-update",
      "budget",
      "intake",
      "schedule",
      "purchase-orders",
      "rfqs",
      "field",
      "context",
    ],
  },
]

export function roleLensForId(roleId: ProjectWorkflowRoleId): RoleLens {
  for (const role of PROJECT_WORKFLOW_ROLE_LENSES) {
    if (role.id === roleId) return role
  }

  return PROJECT_MANAGER_ROLE_LENS
}

export function workflowRoleIdFromString(
  value: string | null | undefined,
): ProjectWorkflowRoleId | null {
  if (!value) return null

  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

  switch (normalized) {
    case "admin-owner":
    case "owner-admin":
    case "developer-admin":
    case "admin":
    case "secondary-admin":
    case "executive":
      return "admin-owner"
    case "pm":
    case "project-manager":
    case "manager":
      return "project-manager"
    case "apm":
    case "assistant-pm":
    case "assistant-project-manager":
    case "coordinator":
      return "assistant-project-manager"
    case "project-admin":
    case "project-administrator":
    case "administrator":
    case "accounting":
      return "project-administrator"
    case "field-superintendent":
    case "superintendent":
    case "field-admin":
      return "field-superintendent"
    case "field":
    case "field-crew":
    case "crew":
      return "field-crew"
    case "architectural-designer":
    case "designer":
    case "drafter":
    case "lead-estimator":
    case "assistant-estimator":
    case "estimator":
    case "design-estimating":
      return "design-estimating"
    case "office-manager":
    case "office":
      return "office-manager"
    default:
      if (normalized.includes("assistant-project")) {
        return "assistant-project-manager"
      }
      if (
        normalized.includes("project-administrator") ||
        normalized.includes("project-admin") ||
        normalized.includes("accounting")
      ) {
        return "project-administrator"
      }
      if (
        normalized.includes("field-superintendent") ||
        normalized.includes("superintendent") ||
        normalized.includes("senior-field")
      ) {
        return "field-superintendent"
      }
      if (normalized.includes("field-crew")) {
        return "field-crew"
      }
      if (
        normalized.includes("architectural-designer") ||
        normalized.includes("design") ||
        normalized.includes("drafter") ||
        normalized.includes("estimator")
      ) {
        return "design-estimating"
      }
      if (
        normalized.includes("office-manager") ||
        normalized.includes("business-development")
      ) {
        return "office-manager"
      }
      if (normalized.includes("project-manager")) {
        return "project-manager"
      }
      return null
  }
}

export function workflowRoleIdFromSageEmployee({
  employeeName,
  positionTitle,
}: {
  readonly employeeName: string | null | undefined
  readonly positionTitle: string | null | undefined
}): ProjectWorkflowRoleId | null {
  const normalizedName = (employeeName ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim()
  const normalizedTitle = (positionTitle ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim()

  if (normalizedName === "martine y vogel" || normalizedName === "martine vogel") {
    return "admin-owner"
  }

  if (normalizedTitle.includes("assistant proje")) {
    return "assistant-project-manager"
  }
  if (normalizedTitle.includes("superintendent")) {
    return "field-superintendent"
  }
  if (normalizedTitle.includes("senior field")) {
    return "field-superintendent"
  }
  if (normalizedTitle.includes("field crew")) {
    return "field-crew"
  }
  if (normalizedTitle.includes("accounting")) {
    return "project-administrator"
  }
  if (normalizedTitle.includes("design")) {
    return "design-estimating"
  }
  if (normalizedTitle.includes("business develo")) {
    return "office-manager"
  }
  if (normalizedTitle.includes("jack of all")) {
    return "project-manager"
  }
  if (normalizedTitle.includes("jill of all")) {
    return "admin-owner"
  }

  return workflowRoleIdFromString(positionTitle)
}

export function defaultWorkflowRoleId({
  projectRole,
  userRole,
  canUseDeveloperMode,
}: {
  readonly projectRole: string | null
  readonly userRole: string | null
  readonly canUseDeveloperMode: boolean
}): ProjectWorkflowRoleId {
  const projectWorkflowRole = workflowRoleIdFromString(projectRole)
  if (projectWorkflowRole) return projectWorkflowRole

  if (canUseDeveloperMode) return "admin-owner"

  const userWorkflowRole = workflowRoleIdFromString(userRole)
  if (userWorkflowRole) return userWorkflowRole

  return PROJECT_MANAGER_ROLE_LENS.id
}

export function isProjectWorkflowRoleId(
  value: string | null,
): value is ProjectWorkflowRoleId {
  return workflowRoleIdFromString(value) === value
}
