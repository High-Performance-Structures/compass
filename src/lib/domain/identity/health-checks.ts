/**
 * The identity module's entries in the production drift detector's registry
 * (src/lib/domain/data-health/status-checks.ts; issue #1329). Declared here
 * because identity owns project_access_invitations for reads too.
 */
import { projectAccessInvitations } from "@/db/schema"
import type { StatusCheck } from "@/lib/domain/data-health/check-types"

import { invitationMachine } from "./invitation-machine"

export const IDENTITY_STATUS_CHECKS: readonly StatusCheck[] = [
  {
    kind: "machine",
    machine: invitationMachine,
    column: projectAccessInvitations.status,
    owner: { organization: projectAccessInvitations.organizationId, project: projectAccessInvitations.projectId },
  },
]
