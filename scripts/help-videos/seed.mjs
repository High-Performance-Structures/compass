// Seeds an isolated local database for recording Help tutorial videos.
// Everything here is fictional; it never touches a shared or production DB.
import Database from "better-sqlite3"
import { resolve } from "node:path"

const db = new Database(resolve(process.env.LOCAL_DB_PATH || ".help-videos/compass.db"))
const now = new Date().toISOString()

db.transaction(() => {
  db.prepare(`INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at)
    VALUES ('hps-org-001', 'HPS', 'hps', 'internal', 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, is_active = 1`).run(now, now)
  // Matches the local developer sign-in in src/lib/auth.ts.
  db.prepare(`INSERT INTO users (id, email, first_name, last_name, display_name, role, is_active, created_at, updated_at)
    VALUES ('dev-user-1', 'dev@compass.io', 'Dev', 'User', 'Dev User', 'admin', 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET role = 'admin', is_active = 1`).run(now, now)
  db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, role, joined_at)
    VALUES ('help-video-membership', 'hps-org-001', 'dev-user-1', 'admin', ?)
    ON CONFLICT(id) DO NOTHING`).run(now)
  db.prepare(`INSERT INTO projects (id, project_number, name, status, address, client_name, project_manager,
      organization_id, owner_updates_enabled, owner_update_channel, owner_update_cadence, schedule_published, created_at, updated_at)
    VALUES ('compass-developer', 'H-DEV-001', 'Compass Developer', 'OPEN', '100 Example Way, Woodland Park, CO',
      'Example Owner', 'Dev User', 'hps-org-001', 1, 'compass', 'weekly', 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, organization_id = excluded.organization_id, status = 'OPEN'`).run(now, now)
  db.prepare(`INSERT INTO project_members (id, project_id, user_id, role, assigned_at)
    VALUES ('help-video-project-member', 'compass-developer', 'dev-user-1', 'project_manager', ?)
    ON CONFLICT(id) DO NOTHING`).run(now)
  // A second (fictional) teammate so a message has someone to mention.
  db.prepare(`INSERT INTO users (id, email, first_name, last_name, display_name, role, is_active, created_at, updated_at)
    VALUES ('help-video-pm', 'sam.rivera@example.com', 'Sam', 'Rivera', 'Sam Rivera', 'project_manager', 1, ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(now, now)
  db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, role, joined_at)
    VALUES ('help-video-pm-membership', 'hps-org-001', 'help-video-pm', 'member', ?)
    ON CONFLICT(id) DO NOTHING`).run(now)
  db.prepare(`INSERT INTO channels (id, name, type, description, organization_id, project_id, is_private,
      audience, created_by, sort_order, created_at, updated_at)
    VALUES ('help-video-channel', 'h-dev-001-project-team', 'text', 'Compass Developer project team',
      'hps-org-001', 'compass-developer', 0, 'staff', 'dev-user-1', 1, ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(now, now)
  for (const [id, userId, role] of [["help-video-cm-1", "dev-user-1", "owner"], ["help-video-cm-2", "help-video-pm", "member"]]) {
    db.prepare(`INSERT INTO channel_members (id, channel_id, user_id, role, notify_level, joined_at)
      VALUES (?, 'help-video-channel', ?, ?, 'all', ?) ON CONFLICT(id) DO NOTHING`).run(id, userId, role, now)
  }
  db.prepare(`DELETE FROM messages WHERE channel_id = 'help-video-channel'`).run()
  db.prepare(`INSERT INTO messages (id, channel_id, user_id, content, is_pinned, reply_count, created_at)
    VALUES ('help-video-message-1', 'help-video-channel', 'help-video-pm',
      'Concrete sub confirmed the north footing pour for Tuesday morning.', 0, 0, ?)`).run(now)

  // A fictional owner company and person who already has a Compass login,
  // so "Invite to Compass" grants project access without sending email.
  db.prepare(`INSERT INTO customers (id, name, company, email, relationship_type, organization_id, created_at)
    VALUES ('help-video-customer', 'Lakeside Family Trust', 'Lakeside Family Trust', 'jordan.lee@example.com',
      'client', 'hps-org-001', ?)
    ON CONFLICT(id) DO UPDATE SET organization_id = 'hps-org-001'`).run(now)
  db.prepare(`INSERT INTO users (id, email, first_name, last_name, display_name, role, is_active, created_at, updated_at)
    VALUES ('help-video-owner', 'jordan.lee@example.com', 'Jordan', 'Lee', 'Jordan Lee', 'client', 1, ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(now, now)
  db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, role, joined_at)
    VALUES ('help-video-owner-membership', 'hps-org-001', 'help-video-owner', 'client', ?)
    ON CONFLICT(id) DO UPDATE SET organization_id = 'hps-org-001'`).run(now)
  db.prepare(`INSERT INTO customer_contacts (id, customer_id, user_id, name, title, email, is_primary, active, created_at, updated_at)
    VALUES ('help-video-customer-contact', 'help-video-customer', 'help-video-owner', 'Jordan Lee', 'Owner',
      'jordan.lee@example.com', 1, 1, ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(now, now)
  db.prepare(`DELETE FROM project_contacts WHERE project_id = 'compass-developer'`).run()
  db.prepare(`DELETE FROM project_access_invitations WHERE project_id = 'compass-developer'`).run()
  db.prepare(`DELETE FROM project_members WHERE project_id = 'compass-developer' AND user_id = 'help-video-owner'`).run()

  // A few illustrative cost codes for estimate clips.
  const costCodes = [
    ["03-3000", "Cast-in-place concrete", "03", "Concrete"],
    ["03-2000", "Concrete reinforcing", "03", "Concrete"],
    ["06-1000", "Rough carpentry", "06", "Wood, Plastics, and Composites"],
  ]
  for (const [code, description, division, divisionName] of costCodes) {
    db.prepare(`INSERT INTO sage_cost_codes (id, source_system, code, description, display_label, division_code,
        division_description, division_display_label, active, sync_status, created_at, updated_at)
      VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, 1, 'manual', ?, ?) ON CONFLICT(id) DO NOTHING`)
      .run(`help-video-cc-${code}`, code, description, `${code} ${description}`, division, divisionName,
        `${division} ${divisionName}`, now, now)
  }
  db.prepare(`DELETE FROM project_estimates WHERE project_id = 'compass-developer'`).run()

  // Clips that create records start from an empty project each run.
  db.prepare(`DELETE FROM daily_logs WHERE project_id = 'compass-developer'`).run()

  // Photos awaiting review. The recorder serves sample images for these IDs,
  // so the Drive file IDs below never resolve to real files.
  const photos = [
    ["help-photo-1", "north-footing-forms.jpg", "North footing forms"],
    ["help-photo-2", "rebar-inspection.jpg", "Rebar inspection"],
    ["help-photo-3", "concrete-pump-setup.jpg", "Concrete pump setup"],
    ["help-photo-4", "site-cleanup.jpg", "Site cleanup"],
  ]
  for (const [index, [id, fileName, caption]] of photos.entries()) {
    db.prepare(`INSERT INTO daily_log_photos (id, project_id, uploaded_by, file_name, mime_type, drive_file_id,
        caption, captured_at, upload_status, review_status, owner_visible, sub_vendor_visible, public_shareable,
        photo_kind, sort_order, created_at, updated_at)
      VALUES (?, 'compass-developer', 'dev-user-1', ?, 'image/jpeg', ?, ?, ?, 'uploaded', 'needs_review', 0, 0, 0,
        'progress', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET review_status = 'needs_review', owner_visible = 0, sub_vendor_visible = 0,
        public_shareable = 0, updated_at = excluded.updated_at`)
      .run(id, fileName, `sample-${id}`, caption, now, index, now, now)
  }
})()
console.log("Seeded the Compass Developer recording workspace.")
