import { z } from "zod/v4"

/*
 * Settings > Workflows > Sage contact review: who may approve a Sage contact
 * change or a new Sage person, and whether staff are linked to their Sage
 * employee by email and follow its current/inactive status. Pure and client-safe. Approving always needs
 * the Sage contact review approve permission; this only decides whether the
 * person who asked for the change may also approve it.
 */
const sageContactReviewSettingsSchema = z.object({
  /** True: someone other than the requester must approve. False (default): the requester may approve their own. */
  requireSecondApprover: z.boolean(),
  /** Link unlinked staff to the one current Sage employee with the same email when Sage's employee list is read. */
  autoLinkEmployeesByEmail: z.boolean(),
  /** A linked staff contact turns inactive when Sage shows the employee not current, and active again when current. */
  employeeStatusFollowsSage: z.boolean(),
})

export type SageContactReviewSettings = z.infer<typeof sageContactReviewSettingsSchema>

const DEFAULT_SAGE_CONTACT_REVIEW_SETTINGS: SageContactReviewSettings = {
  requireSecondApprover: false,
  autoLinkEmployeesByEmail: true,
  employeeStatusFollowsSage: true,
}

export const SAGE_CONTACT_REVIEW_SETTINGS_GROUP = {
  label: "Sage contact review",
  description:
    "Whether a staff member who can approve Sage contact changes may approve their own, and how staff are tied to their Sage employee record.",
  defaults: DEFAULT_SAGE_CONTACT_REVIEW_SETTINGS,
  schema: sageContactReviewSettingsSchema,
}

/**
 * True when the company's rule lets this reviewer approve this request:
 * always, unless the company requires a second approver and the reviewer is
 * the requester. The approve permission is checked separately.
 */
export function sageContactReviewerAllowed(
  settings: SageContactReviewSettings,
  requestedByUserId: string | null,
  reviewerUserId: string
): boolean {
  return !settings.requireSecondApprover || requestedByUserId !== reviewerUserId
}
