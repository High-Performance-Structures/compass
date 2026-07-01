#!/usr/bin/env bun
/**
 * Idempotent seed script for demo organization data.
 *
 * Creates "High Performance Structures, Inc." (demo org) with:
 * - 3 projects, 5 customers, 5 vendors
 * - 23 schedule tasks per project (69 total)
 * - 3 channels with 25 messages
 *
 * Safe to re-run: exits early if demo org already exists.
 */

import { Database } from "bun:sqlite"
import { resolve, join } from "path"
import { randomUUID } from "crypto"
import { existsSync, readdirSync } from "fs"

const DEMO_ORG_ID = "demo-org-meridian"
const DEMO_USER_ID = "demo-user-001"

function findDatabase(): string {
  const dbDir = resolve(
    process.cwd(),
    ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"
  )

  if (!existsSync(dbDir)) {
    console.error(`Database directory not found: ${dbDir}`)
    console.error("Run 'bun dev' first to create the local database.")
    process.exit(1)
  }

  const files = readdirSync(dbDir)
  const sqliteFile = files.find((f: string) => f.endsWith(".sqlite"))

  if (!sqliteFile) {
    console.error(`No .sqlite file found in ${dbDir}`)
    process.exit(1)
  }

  return join(dbDir, sqliteFile)
}

function seed(dbPath: string) {
  const db = new Database(dbPath)
  db.run("PRAGMA journal_mode = WAL")
  const now = new Date().toISOString()

  // idempotency check
  const existingOrg = db
    .prepare("SELECT id FROM organizations WHERE id = ?")
    .get(DEMO_ORG_ID)
  if (existingOrg) {
    console.log("Demo org already exists, skipping seed.")
    db.close()
    return
  }

  console.log("Seeding demo data...\n")

  const tx = db.transaction(() => {
    // 1. demo organization
    db.prepare(
      `INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    ).run(DEMO_ORG_ID, "High Performance Structures, Inc.", "hps-demo", "demo", now, now)
    console.log("1. Created demo organization")

    // 2. demo user
    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, first_name, last_name, display_name, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(DEMO_USER_ID, "demo@compass.build", "Demo", "User", "Demo User", "admin", now, now)
    console.log("2. Created demo user")

    // 3. link user to org
    db.prepare(
      `INSERT INTO organization_members (id, organization_id, user_id, role, joined_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(randomUUID(), DEMO_ORG_ID, DEMO_USER_ID, "admin", now)
    console.log("3. Linked demo user to organization")

    // 4. projects
    const projects = [
      { id: randomUUID(), name: "Riverside Tower" },
      { id: randomUUID(), name: "Harbor Bridge Rehabilitation" },
      { id: randomUUID(), name: "Downtown Transit Hub" },
    ]

    for (const p of projects) {
      db.prepare(
        `INSERT INTO projects (id, name, status, organization_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(p.id, p.name, "active", DEMO_ORG_ID, now)
    }
    console.log("4. Created 3 projects")

    // 5. customers
    const customers = [
      "Metropolitan Construction Corp",
      "Riverside Development LLC",
      "Harbor City Ventures",
      "Transit Authority Partners",
      "Downtown Realty Group",
    ]
    for (const name of customers) {
      db.prepare(
        `INSERT INTO customers (id, name, organization_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(randomUUID(), name, DEMO_ORG_ID, now, now)
    }
    console.log("5. Created 5 customers")

    // 6. vendors
    const vendors = [
      "Ace Steel & Fabrication",
      "Premier Concrete Supply",
      "ElectroTech Solutions",
      "Harbor HVAC Systems",
      "Summit Plumbing & Mechanical",
    ]
    for (const name of vendors) {
      db.prepare(
        `INSERT INTO vendors (id, name, category, organization_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(randomUUID(), name, "Subcontractor", DEMO_ORG_ID, now, now)
    }
    console.log("6. Created 5 vendors")

    // 7. schedule tasks per project
    const taskTemplates = [
      { title: "Site Preparation & Excavation", workdays: 10, phase: "Foundation", pct: 100 },
      { title: "Foundation Formwork", workdays: 7, phase: "Foundation", pct: 100 },
      { title: "Foundation Concrete Pour", workdays: 3, phase: "Foundation", pct: 100 },
      { title: "Foundation Curing", workdays: 14, phase: "Foundation", pct: 100 },
      { title: "Structural Steel Erection", workdays: 20, phase: "Structural", pct: 85 },
      { title: "Concrete Deck Installation", workdays: 15, phase: "Structural", pct: 70 },
      { title: "Exterior Framing", workdays: 12, phase: "Envelope", pct: 60 },
      { title: "Window & Door Installation", workdays: 10, phase: "Envelope", pct: 40 },
      { title: "Roofing Installation", workdays: 8, phase: "Envelope", pct: 30 },
      { title: "Electrical Rough-In", workdays: 15, phase: "MEP", pct: 25 },
      { title: "Plumbing Rough-In", workdays: 12, phase: "MEP", pct: 20 },
      { title: "HVAC Installation", workdays: 18, phase: "MEP", pct: 15 },
      { title: "Fire Sprinkler System", workdays: 10, phase: "MEP", pct: 10 },
      { title: "Drywall Installation", workdays: 14, phase: "Interior", pct: 5 },
      { title: "Interior Painting", workdays: 10, phase: "Interior", pct: 0 },
      { title: "Flooring Installation", workdays: 12, phase: "Interior", pct: 0 },
      { title: "Cabinet & Fixture Installation", workdays: 8, phase: "Interior", pct: 0 },
      { title: "Final Electrical Trim", workdays: 5, phase: "Finishes", pct: 0 },
      { title: "Final Plumbing Fixtures", workdays: 5, phase: "Finishes", pct: 0 },
      { title: "Site Landscaping", workdays: 10, phase: "Site Work", pct: 0 },
      { title: "Parking Lot Paving", workdays: 7, phase: "Site Work", pct: 0 },
      { title: "Final Inspection", workdays: 2, phase: "Closeout", pct: 0 },
      { title: "Punch List Completion", workdays: 5, phase: "Closeout", pct: 0 },
    ]

    let taskCount = 0
    for (const project of projects) {
      let currentDate = new Date("2025-01-15")

      for (const t of taskTemplates) {
        const endDate = new Date(currentDate)
        endDate.setDate(endDate.getDate() + t.workdays - 1)

        const status = t.pct === 100 ? "COMPLETED" : t.pct > 0 ? "IN_PROGRESS" : "PENDING"

        db.prepare(
          `INSERT INTO schedule_tasks
           (id, project_id, title, start_date, workdays, end_date_calculated,
            phase, status, percent_complete, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          randomUUID(),
          project.id,
          t.title,
          currentDate.toISOString().split("T")[0],
          t.workdays,
          endDate.toISOString().split("T")[0],
          t.phase,
          status,
          t.pct,
          taskCount,
          now,
          now
        )

        currentDate = new Date(endDate)
        currentDate.setDate(currentDate.getDate() + 1)
        taskCount++
      }
    }
    console.log(`7. Created ${taskCount} schedule tasks`)

    // 8. channel category
    const categoryId = randomUUID()
    db.prepare(
      `INSERT INTO channel_categories (id, name, organization_id, position, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(categoryId, "General", DEMO_ORG_ID, 0, now)

    // 9. channels with messages
    const channelDefs = [
      { name: "general", type: "text", desc: "General discussion" },
      { name: "project-updates", type: "text", desc: "Project status updates" },
      { name: "announcements", type: "announcement", desc: "Team announcements" },
    ]

    const msgTemplates: Record<string, string[]> = {
      general: [
        "Morning team! Ready to tackle today's tasks.",
        "Quick reminder: safety meeting at 2pm today.",
        "Has anyone seen the updated foundation drawings?",
        "Great progress on the structural steel this week!",
        "Lunch truck will be here at noon.",
        "Weather looks good for concrete pour tomorrow.",
        "Don't forget to sign off on your timesheets.",
        "Electrical inspection passed with no issues!",
        "New delivery of materials arriving Thursday.",
        "Team huddle in 10 minutes.",
      ],
      "project-updates": [
        "Riverside Tower: Foundation phase completed ahead of schedule.",
        "Harbor Bridge: Steel erection 85% complete, on track.",
        "Transit Hub: Envelope work progressing well despite weather delays.",
        "All three projects maintaining budget targets this month.",
        "Updated schedules uploaded to the system.",
        "Client walkthrough scheduled for Friday morning.",
        "MEP rough-in starting next week on Riverside Tower.",
        "Harbor Bridge inspection results look excellent.",
        "Transit Hub: Window installation begins Monday.",
        "Monthly progress photos added to project files.",
      ],
      announcements: [
        "Welcome to the Compass demo! Explore the platform features.",
        "New safety protocols in effect starting next Monday.",
        "Quarterly project review meeting scheduled for next Friday.",
        "Updated project templates now available in the system.",
        "Reminder: Submit all change orders by end of week.",
      ],
    }

    let msgCount = 0
    for (const ch of channelDefs) {
      const channelId = randomUUID()
      db.prepare(
        `INSERT INTO channels
         (id, name, type, description, organization_id, category_id,
          is_private, created_by, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)`
      ).run(channelId, ch.name, ch.type, ch.desc, DEMO_ORG_ID, categoryId, DEMO_USER_ID, now, now)

      // add member
      db.prepare(
        `INSERT INTO channel_members (id, channel_id, user_id, role, notify_level, joined_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(randomUUID(), channelId, DEMO_USER_ID, "owner", "all", now)

      // add messages
      const msgs = msgTemplates[ch.name] ?? []
      for (const content of msgs) {
        db.prepare(
          `INSERT INTO messages (id, channel_id, user_id, content, reply_count, created_at)
           VALUES (?, ?, ?, ?, 0, ?)`
        ).run(randomUUID(), channelId, DEMO_USER_ID, content, now)
        msgCount++
      }
    }
    console.log(`8. Created 3 channels with ${msgCount} messages`)
  })

  try {
    tx()
    console.log("\nDemo seed completed successfully.")
  } catch (error) {
    console.error("\nDemo seed failed:", error)
    process.exit(1)
  } finally {
    db.close()
  }
}

const dbPath = findDatabase()
console.log(`Using database: ${dbPath}\n`)
seed(dbPath)
