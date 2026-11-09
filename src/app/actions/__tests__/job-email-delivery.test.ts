import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { context, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"
import { REQUEST_COI_TEMPLATE, SEND_W9_TEMPLATE } from "@/lib/job-workflows/email-delivery"
import { getJobEmailDeliverySettings, removeJobEmailW9, saveJobEmailDeliverySettings } from "../job-email-delivery-settings"
import { getJobEmailDraft, sendJobEmail } from "../job-emails"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), deliver: vi.fn(), activity: vi.fn(), notify: vi.fn() }))
let database: CorrespondenceTestDatabase
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth, getCurrentUser: mocks.auth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: database.d1 } }) }))
vi.mock("@/lib/permission-enforcement", () => ({ requireFeaturePermission: vi.fn() }))
vi.mock("@/lib/project-access", () => ({ getProjectAccessRecord: async () => ({ organizationId: "org-a" }) }))
vi.mock("@/lib/feature-settings/server", () => ({ readFeatureSettings: async () => ({ templates: {} }) }))
vi.mock("@/lib/department-profiles-server", async () => {
  const { DEFAULT_DEPARTMENT_PROFILES } = await import("@/lib/department-profiles")
  return { readDepartmentProfiles: async () => DEFAULT_DEPARTMENT_PROFILES }
})
vi.mock("@/lib/email/staff-sender", () => ({
  resolveStaffEmailSender: async () => ({ success: true, sender: { address: "staff-a@example.test", name: "Staff A" } }),
}))
vi.mock("@/lib/email/tracked-send", () => ({ sendTrackedEmail: mocks.deliver }))
vi.mock("@/lib/notifications/events", () => ({
  createNotificationEvent: mocks.notify,
  projectInternalRecipients: async () => [{ userId: "other-staff", email: "staff@example.test" }],
}))
vi.mock("@/lib/notifications/clear-on-read", () => ({ clearOverdueFollowUpReminders: async () => {} }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.activity, activityActorName: () => "Staff A" }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const PROJECT = "project-a"
const CLIENT = "owner-a@example.test"
const AGENT = "agent@example.test"

beforeEach(() => {
  vi.clearAllMocks()
  database = openCorrespondenceTestDatabase()
  database.sqlite.exec(`
    ALTER TABLE projects ADD COLUMN status TEXT;
    ALTER TABLE projects ADD COLUMN address TEXT;
    ALTER TABLE projects ADD COLUMN client_name TEXT;
    UPDATE projects SET project_number = 'H-1', address = '1 Ridge Road' WHERE id = 'project-a';
    INSERT INTO project_contacts (id, project_id, contact_type, display_name, email) VALUES
      ('client', 'project-a', 'owner', 'Pat Lee', '${CLIENT}'),
      ('supplier', 'project-a', 'supplier', 'Supplier', 'supplier@example.test');
  `)
  for (const migration of ["0101_project_profile_follow_up", "0106_project_interaction_client_touch", "0308_user_alternate_emails", "0313_job_email_delivery_settings"]) {
    database.sqlite.exec(readFileSync(`drizzle/${migration}.sql`, "utf8"))
  }
  database.sqlite.exec("ALTER TABLE project_interactions ADD COLUMN daily_log_id TEXT")
  mocks.auth.mockResolvedValue(context(database, "staff-a", PROJECT).user)
  mocks.deliver.mockResolvedValue({ status: "sent" })
})

afterEach(() => database.close())

function settingsForm(pdf?: string): FormData {
  const form = new FormData()
  form.set("insuranceAgentEmail", AGENT)
  if (pdf !== undefined) form.set("w9", new File([pdf], "Company W-9.pdf", { type: "application/pdf" }))
  return form
}

function sendForm(templateId: string, to: string, version?: string): FormData {
  const form = new FormData()
  form.set("projectId", PROJECT)
  form.set("templateId", templateId)
  form.set("subject", "Reviewed subject")
  form.set("body", "Reviewed message")
  form.set("to", to)
  if (version) form.set("w9Version", version)
  return form
}

describe("job document emails", () => {
  it("prefills the agent and client details, then sends only to the configured agent", async () => {
    expect(await getJobEmailDraft(PROJECT, REQUEST_COI_TEMPLATE)).toMatchObject({ success: false, error: expect.stringContaining("Settings") })
    expect(await saveJobEmailDeliverySettings(settingsForm())).toMatchObject({ success: true })
    const draft = await getJobEmailDraft(PROJECT, REQUEST_COI_TEMPLATE)
    if (!draft.success) throw new Error(draft.error)
    expect(draft).toMatchObject({ success: true, data: { to: [AGENT], body: expect.stringContaining(CLIENT) } })
    expect(await sendJobEmail(sendForm(REQUEST_COI_TEMPLATE, CLIENT))).toMatchObject({ success: false })
    expect(mocks.deliver).not.toHaveBeenCalled()

    expect(await sendJobEmail(sendForm(REQUEST_COI_TEMPLATE, AGENT))).toEqual({ success: true, data: { loggedContact: false } })
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ kind: "job_email", to: [AGENT], attachments: [] }))
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ eventType: "job_email.coi_requested" }))
    expect(database.sqlite.prepare("SELECT * FROM project_interactions").all()).toEqual([])
  })

  it("attaches only the reviewed version of the private PDF and limits its recipients", async () => {
    expect(await saveJobEmailDeliverySettings(settingsForm("not a PDF"))).toMatchObject({ success: false })
    const first = await saveJobEmailDeliverySettings(settingsForm("%PDF-1.7 first"))
    if (!first.success || !first.data.w9Version) throw new Error("First upload failed")
    const pdf = "%PDF-1.7 replacement"
    const replacement = await saveJobEmailDeliverySettings(settingsForm(pdf))
    if (!replacement.success || !replacement.data.w9Version) throw new Error("Replacement failed")
    const version = replacement.data.w9Version

    const draft = await getJobEmailDraft(PROJECT, SEND_W9_TEMPLATE)
    if (!draft.success) throw new Error(draft.error)
    expect(draft).toMatchObject({
      success: true, data: { to: [CLIENT], requiredAttachment: { filename: "Company W-9.pdf", version } },
    })
    expect(JSON.stringify(draft)).not.toContain(pdf)
    expect(await sendJobEmail(sendForm(SEND_W9_TEMPLATE, CLIENT, first.data.w9Version))).toMatchObject({ success: false })
    expect(await sendJobEmail(sendForm(SEND_W9_TEMPLATE, "supplier@example.test", version))).toMatchObject({ success: false })
    expect(await removeJobEmailW9(first.data.w9Version)).toMatchObject({ success: false })
    expect(mocks.deliver).not.toHaveBeenCalled()

    expect(await sendJobEmail(sendForm(SEND_W9_TEMPLATE, CLIENT, version))).toEqual({ success: true, data: { loggedContact: true } })
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({
      to: [CLIENT],
      attachments: [{ filename: "Company W-9.pdf", contentType: "application/pdf", content: new TextEncoder().encode(pdf) }],
    }))
    expect(database.sqlite.prepare("SELECT project_contact_id FROM project_interactions").all()).toEqual([{ project_contact_id: "client" }])

    expect(await removeJobEmailW9(version)).toMatchObject({ success: true, data: { w9Filename: null } })
    expect(await sendJobEmail(sendForm(SEND_W9_TEMPLATE, CLIENT, version))).toMatchObject({ success: false })
    expect(mocks.deliver).toHaveBeenCalledTimes(1)
  })

  it("keeps settings within the organization and blocks external users", async () => {
    expect(await saveJobEmailDeliverySettings(settingsForm("%PDF-1.7 org A"))).toMatchObject({ success: true })
    mocks.auth.mockResolvedValue(context(database, "staff-b", "project-other").user)
    expect(await getJobEmailDeliverySettings()).toEqual({
      success: true, data: { insuranceAgentEmail: null, w9Version: null, w9Filename: null },
    })
    expect(await getJobEmailDraft(PROJECT, SEND_W9_TEMPLATE)).toMatchObject({ success: false })

    mocks.auth.mockResolvedValue(context(database, "owner-a", PROJECT).user)
    expect(await getJobEmailDeliverySettings()).toMatchObject({ success: false })
    expect(await saveJobEmailDeliverySettings(settingsForm())).toMatchObject({ success: false })
  })
})
