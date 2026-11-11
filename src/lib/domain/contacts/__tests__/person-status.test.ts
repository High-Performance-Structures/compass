/**
 * One rule for current staff and archived people on a job's contacts
 * (person-status.ts) and the archive cascade (person-archive.ts), against an
 * in-memory SQLite copy of the tables. Every name here is fictional.
 */
import Database from "better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  customerContacts,
  customers,
  internalContacts,
  organizationMembers,
  organizations,
  projectAccessInvitations,
  projectContacts,
  projectContactSourceLinks,
  projectMembers,
  projects,
  userAlternateEmails,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { messages } from "@/db/schema-conversations"

const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn() }))
vi.mock("@/db", () => ({ getDb: mocks.db }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user, requireAuth: mocks.user }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {} } }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { getProjectContactsSummary } from "@/app/actions/project-contacts"
import { loadProjectTaskAssigneeOptions } from "@/lib/domain/contacts/assignees"
import { setInternalPersonArchived } from "@/lib/domain/contacts/internal-people"
import { directoryPersonJobCount, removeArchivedPeopleFromJobs } from "@/lib/domain/contacts/person-archive"
import { deactivateVendorPeople } from "@/lib/domain/contacts/store"
import { importedMessageColumns } from "@/lib/domain/conversations/imported"
import { projectEmailRecipientOptions } from "@/lib/email/project-recipient-options"
import { projectContactCanInvite } from "@/lib/project-contact-access-status"

const TABLES: readonly SQLiteTable[] = [
  projects,
  projectContacts,
  customers,
  customerContacts,
  vendors,
  vendorContacts,
  internalContacts,
  users,
  organizationMembers,
  organizations,
  projectAccessInvitations,
  projectMembers,
  projectContactSourceLinks,
  userAlternateEmails,
  messages,
]

const NOW = "2026-11-10T00:00:00.000Z"
let sqlite: InstanceType<typeof Database>
let db: ReturnType<typeof makeDb>

function makeDb() {
  const inner = drizzle(sqlite)
  return Object.assign(inner, {
    batch: async (queries: readonly { run(): unknown }[]) => sqlite.transaction(() => queries.map((query) => query.run()))(),
  })
}

// The tests pass this in-memory database where the domain expects D1.
function d1(): Parameters<typeof removeArchivedPeopleFromJobs>[0] {
  // @ts-expect-error better-sqlite3 drizzle stands in for D1 in tests
  return db
}

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite
    .prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...Object.values(row))
}

function user(id: string, email: string, name: string, active: boolean, role: string | null): void {
  insert("users", { id, email, display_name: name, role: "office", is_active: active ? 1 : 0, created_at: NOW, updated_at: NOW })
  if (role) insert("organization_members", { id: `member-${id}`, organization_id: "org-1", user_id: id, role, joined_at: NOW })
}

function projectContact(id: string, row: Record<string, string | number | null>): void {
  insert("project_contacts", {
    id,
    project_id: "project-1",
    contact_type: "internal",
    source_system: "buildertrend",
    source_entity_type: "buildertrend_participant",
    display_name: id,
    owner_portal_visible: 0,
    sub_vendor_portal_visible: 0,
    internal_visible: 1,
    primary_contact: 0,
    active: 1,
    sort_order: 0,
    sync_status: "manual",
    created_at: NOW,
    updated_at: NOW,
    ...row,
  })
}

function contactRow(id: string): { readonly active: number; readonly notes: string | null } | undefined {
  const row: unknown = sqlite.prepare("SELECT active, notes FROM project_contacts WHERE id = ?").get(id)
  if (row === undefined || row === null || typeof row !== "object") return undefined
  return { active: Number(Reflect.get(row, "active")), notes: Reflect.get(row, "notes") ?? null }
}

function memberCount(userId: string): number {
  const row: unknown = sqlite.prepare("SELECT count(*) AS n FROM project_members WHERE user_id = ?").get(userId)
  return row !== null && typeof row === "object" ? Number(Reflect.get(row, "n")) : 0
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  for (const table of TABLES) {
    const config = getTableConfig(table)
    sqlite.exec(`CREATE TABLE ${config.name} (${config.columns.map((column) => `"${column.name}"`).join(", ")})`)
  }
  db = makeDb()
  mocks.db.mockReturnValue(db)
  mocks.user.mockResolvedValue({ id: "viewer", organizationId: "org-1", organizationType: "internal", role: "admin", isActive: true })

  insert("organizations", { id: "org-1", name: "Example Builders", slug: "example", type: "internal", is_active: 1, created_at: NOW, updated_at: NOW })
  for (const id of ["project-1", "project-2"]) {
    insert("projects", { id, organization_id: "org-1", name: id, status: "OPEN", created_at: NOW, updated_at: NOW })
  }
  user("u-staff", "staff@example.com", "Avery Example", true, "project_manager")
  user("u-member-staff", "member@example.com", "Blair Example", true, "field_superintendent")
  user("u-former", "former@example.com", "Casey Example", false, "field_crew")
  user("u-left-company", "left@example.com", "Drew Example", true, null)
})

afterEach(() => sqlite.close())

describe("project contacts: current staff and archived people", () => {
  beforeEach(() => {
    // Imported staff rows, matched only by email (no directory link yet).
    projectContact("pc-staff", { email: "STAFF@example.com " })
    projectContact("pc-former", { email: "former@example.com" })
    projectContact("pc-left", { email: "left@example.com" })
    // Added from the user list, and also a project member.
    projectContact("pc-member", { source_entity_type: "user", source_entity_id: "u-member-staff", email: null })
    insert("project_members", { id: "pm-1", project_id: "project-1", user_id: "u-member-staff", role: "field_superintendent", assigned_at: NOW })
    // Linked to an internal directory person who was archived (no account).
    insert("internal_contacts", { id: "ic-archived", organization_id: "org-1", name: "Emery Example", source_system: "manual", active: 0, sync_status: "manual", created_at: NOW, updated_at: NOW })
    projectContact("pc-archived-link", { internal_contact_id: "ic-archived", email: null })
    // Internal row with no Compass account: left as it was.
    projectContact("pc-no-account", { email: "nobody@example.com" })
    // An owner with no account: the invite flow is unchanged.
    projectContact("pc-owner", { contact_type: "owner", owner_portal_visible: 1, email: "owner@example.com", source_system: "compass", source_entity_type: "manual" })
  })

  it("marks active internal staff of the company as company staff, with no invite", async () => {
    const summary = await getProjectContactsSummary("project-1")
    const byId = new Map(summary.allContacts.map((contact) => [contact.id, contact]))
    expect(byId.get("pc-staff")?.accessStatus).toBe("company_staff")
    expect(projectContactCanInvite("company_staff")).toBe(false)
    // A staff member who also has a project_members row still reads as staff.
    expect(byId.get("pc-member")?.accessStatus).toBe("company_staff")
    expect(byId.get("pc-member")?.identityManagedByActiveUser).toBe(true)
  })

  it("folds inactive accounts, people no longer in the company and archived directory people into history", async () => {
    const summary = await getProjectContactsSummary("project-1", "internal", { includeHistorical: true })
    const current = summary.allContacts.map((contact) => contact.id)
    expect(current).not.toContain("pc-former")
    expect(current).not.toContain("pc-left")
    expect(current).not.toContain("pc-archived-link")
    expect(summary.internalCount).toBe(3)
    const history = new Map(summary.historicalContacts.map((contact) => [contact.id, contact]))
    expect(history.get("pc-former")).toMatchObject({ active: false, accessStatus: "not_invited" })
    expect(history.has("pc-left")).toBe(true)
    expect(history.has("pc-archived-link")).toBe(true)
    // Nothing was written.
    expect(contactRow("pc-former")?.active).toBe(1)
  })

  it("drops archived people without listing history when history is not requested", async () => {
    const summary = await getProjectContactsSummary("project-1")
    expect(summary.allContacts.map((contact) => contact.id)).not.toContain("pc-former")
    expect(summary.historicalContacts).toHaveLength(0)
  })

  it("leaves external contacts and accountless internal rows unchanged", async () => {
    const summary = await getProjectContactsSummary("project-1")
    const byId = new Map(summary.allContacts.map((contact) => [contact.id, contact]))
    expect(byId.get("pc-owner")?.accessStatus).toBe("not_invited")
    expect(projectContactCanInvite("not_invited")).toBe(true)
    expect(byId.get("pc-no-account")?.accessStatus).toBe("not_invited")
  })

  it("keeps archived people out of assignee and email recipient pickers", async () => {
    const assignees = await loadProjectTaskAssigneeOptions(d1(), {
      organizationId: "org-1",
      projectId: "project-1",
      grants: { vendors: false, internal: false },
    })
    const ids = assignees.projectContacts.map((option) => option.id)
    expect(ids).toContain("project:pc-staff")
    expect(ids).not.toContain("project:pc-former")
    expect(ids).not.toContain("project:pc-archived-link")

    const recipients = await projectEmailRecipientOptions(d1(), "project-1")
    const emails = recipients.map((option) => option.email)
    expect(emails).toContain("STAFF@example.com ".trim().toLowerCase())
    expect(emails).not.toContain("former@example.com")
  })

  it("names an archived imported-message sender 'Archived user – Name'", async () => {
    insert("messages", { id: "m-1", channel_id: "c-1", content: "Hi", imported_sender_contact_id: "pc-former", created_at: NOW })
    insert("messages", { id: "m-2", channel_id: "c-1", content: "Hi", imported_sender_contact_id: "pc-staff", created_at: NOW })
    const rows = await db.select({ id: messages.id, name: importedMessageColumns.importedSenderName }).from(messages).orderBy(messages.id)
    expect(rows).toEqual([
      { id: "m-1", name: "Archived user – pc-former" },
      { id: "m-2", name: "pc-staff" },
    ])
  })
})

describe("removing a person from Contacts removes them from every job", () => {
  it("archives a staff person off every job, keeping the rows and notes as history", async () => {
    insert("internal_contacts", { id: "ic-leaving", organization_id: "org-1", name: "Finley Example", email: "finley@example.com", source_system: "manual", active: 1, sync_status: "manual", created_at: NOW, updated_at: NOW })
    projectContact("pc-a", { internal_contact_id: "ic-leaving", notes: "Kept note" })
    projectContact("pc-b", { project_id: "project-2", internal_contact_id: "ic-leaving" })
    projectContact("pc-c", { project_id: "project-2", source_entity_type: "internal_contact", source_entity_id: "ic-leaving" })

    expect(await directoryPersonJobCount(d1(), { organizationId: "org-1", kind: "internal_contact", personId: "ic-leaving" })).toBe(2)
    const result = await setInternalPersonArchived(d1(), { organizationId: "org-1", personId: "ic-leaving", archived: true, now: NOW })
    expect(result).toMatchObject({ success: true, jobCount: 2 })
    expect(contactRow("pc-a")).toEqual({ active: 0, notes: "Kept note" })
    expect(contactRow("pc-b")?.active).toBe(0)
    expect(contactRow("pc-c")?.active).toBe(0)
    expect(await directoryPersonJobCount(d1(), { organizationId: "org-1", kind: "internal_contact", personId: "ic-leaving" })).toBe(0)

    // Restoring the person does not put them back on jobs.
    await setInternalPersonArchived(d1(), { organizationId: "org-1", personId: "ic-leaving", archived: false, now: NOW })
    expect(contactRow("pc-a")?.active).toBe(0)
  })

  it("removes a client person's job rows and their account's project memberships", async () => {
    user("u-client", "client@example.com", "Gray Example", true, "client")
    insert("customers", { id: "customer-1", organization_id: "org-1", name: "Example Client", created_at: NOW })
    insert("customer_contacts", { id: "cc-1", customer_id: "customer-1", user_id: "u-client", name: "Gray Example", active: 0, created_at: NOW, updated_at: NOW })
    projectContact("pc-client", { contact_type: "owner", customer_id: "customer-1", customer_contact_id: "cc-1" })
    insert("project_members", { id: "pm-client", project_id: "project-1", user_id: "u-client", role: "client", assigned_at: NOW })

    const result = await removeArchivedPeopleFromJobs(d1(), { organizationId: "org-1", kind: "customer_contact", personIds: ["cc-1"], now: NOW })
    expect(result.jobCount).toBe(1)
    expect(contactRow("pc-client")?.active).toBe(0)
    expect(memberCount("u-client")).toBe(0)
  })

  it("removes vendor people taken out in the vendor editor from jobs", async () => {
    user("u-vendor", "vendor@example.com", "Harper Example", true, "subcontractor")
    insert("vendors", { id: "vendor-1", organization_id: "org-1", name: "Example Framing", created_at: NOW })
    insert("vendor_contacts", { id: "vc-1", vendor_id: "vendor-1", user_id: "u-vendor", name: "Harper Example", active: 1, is_primary: 1, created_at: NOW, updated_at: NOW })
    projectContact("pc-vendor", { contact_type: "subcontractor", vendor_id: "vendor-1", vendor_contact_id: "vc-1" })
    insert("project_members", { id: "pm-vendor", project_id: "project-1", user_id: "u-vendor", role: "subcontractor", assigned_at: NOW })

    await deactivateVendorPeople(d1(), { personIds: ["vc-1"], now: NOW })
    expect(contactRow("pc-vendor")?.active).toBe(0)
    await removeArchivedPeopleFromJobs(d1(), { organizationId: "org-1", kind: "vendor_contact", personIds: ["vc-1"], now: NOW })
    expect(memberCount("u-vendor")).toBe(0)
  })

  it("keeps project memberships of an account that is still active staff", async () => {
    insert("internal_contacts", { id: "ic-staff", organization_id: "org-1", user_id: "u-staff", name: "Avery Example", source_system: "sage", active: 0, sync_status: "manual", created_at: NOW, updated_at: NOW })
    projectContact("pc-sage", { internal_contact_id: "ic-staff" })
    insert("project_members", { id: "pm-staff", project_id: "project-1", user_id: "u-staff", role: "project_manager", assigned_at: NOW })

    await removeArchivedPeopleFromJobs(d1(), { organizationId: "org-1", kind: "internal_contact", personIds: ["ic-staff"], now: NOW })
    expect(contactRow("pc-sage")?.active).toBe(0)
    expect(memberCount("u-staff")).toBe(1)
  })
})

describe("project contacts: vendor invites pending from another job", () => {
  function invitation(id: string, row: Record<string, string | number | null>): void {
    insert("project_access_invitations", {
      id,
      organization_id: "org-1",
      project_id: "project-2",
      email: "vendor@example.com",
      role: "subcontractor",
      status: "sent",
      workos_expires_at: "2099-01-01T00:00:00.000Z",
      email_status: "sent",
      invited_at: NOW,
      ...row,
    })
  }

  beforeEach(() => {
    projectContact("pc-vendor", { contact_type: "subcontractor", sub_vendor_portal_visible: 1, email: "Vendor@example.com" })
    projectContact("pc-owner-invited", { contact_type: "owner", owner_portal_visible: 1, email: "owner2@example.com" })
  })

  it("shows invite pending on this job when the invite was sent from another job", async () => {
    invitation("inv-1", {})
    const summary = await getProjectContactsSummary("project-1")
    const vendor = summary.allContacts.find((contact) => contact.id === "pc-vendor")
    expect(vendor?.accessStatus).toBe("pending")
    // Status only: the vendor gets no membership on this job.
    expect(memberCount("u-vendor")).toBe(0)
  })

  it("ignores expired invites and invites from another company", async () => {
    invitation("inv-expired", { workos_expires_at: "2020-01-01T00:00:00.000Z" })
    insert("organizations", { id: "org-2", name: "Other Builders", slug: "other", type: "internal", is_active: 1, created_at: NOW, updated_at: NOW })
    invitation("inv-other-org", { organization_id: "org-2" })
    const summary = await getProjectContactsSummary("project-1")
    expect(summary.allContacts.find((contact) => contact.id === "pc-vendor")?.accessStatus).toBe("not_invited")
  })

  it("leaves owner contacts to their own job's invites", async () => {
    invitation("inv-owner", { email: "owner2@example.com", role: "client" })
    const summary = await getProjectContactsSummary("project-1")
    expect(summary.allContacts.find((contact) => contact.id === "pc-owner-invited")?.accessStatus).toBe("not_invited")
  })
})
