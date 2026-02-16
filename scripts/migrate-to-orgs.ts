#!/usr/bin/env bun
/**
 * Idempotent migration script to introduce organizations into existing data
 *
 * This script:
 * 1. Creates the HPS organization if it doesn't exist
 * 2. Adds all existing users to the HPS organization
 * 3. Associates all existing customers, vendors, and projects with HPS
 *
 * Safe to run multiple times - checks for existing records before inserting.
 */

import { Database } from "bun:sqlite"
import { resolve, join } from "path"
import { randomUUID } from "crypto"
import { existsSync, readdirSync } from "fs"

const HPS_ORG_ID = "hps-org-001"
const HPS_ORG_NAME = "HPS"
const HPS_ORG_SLUG = "hps"
const HPS_ORG_TYPE = "internal"

const DB_DIR = resolve(
  process.cwd(),
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"
)

function findDatabase(): string {
  if (!existsSync(DB_DIR)) {
    console.error(`Database directory not found: ${DB_DIR}`)
    console.error("Run 'bun dev' at least once to initialize the local D1 database.")
    process.exit(1)
  }

  const files = readdirSync(DB_DIR)
  const sqliteFile = files.find((f: string) => f.endsWith(".sqlite"))

  if (!sqliteFile) {
    console.error(`No .sqlite file found in ${DB_DIR}`)
    process.exit(1)
  }

  return join(DB_DIR, sqliteFile)
}

function main() {
  const dbPath = findDatabase()
  console.log(`Using database: ${dbPath}\n`)

  const db = new Database(dbPath)
  db.run("PRAGMA journal_mode = WAL")

  const timestamp = new Date().toISOString()

  const tx = db.transaction(() => {
    // 1. Create HPS organization
    console.log("1. Checking for HPS organization...")
    const existingOrg = db
      .prepare("SELECT id FROM organizations WHERE id = ?")
      .get(HPS_ORG_ID)

    if (existingOrg) {
      console.log(`   Already exists (${HPS_ORG_ID})`)
    } else {
      db.prepare(
        `INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      ).run(HPS_ORG_ID, HPS_ORG_NAME, HPS_ORG_SLUG, HPS_ORG_TYPE, timestamp, timestamp)
      console.log(`   Created HPS organization (${HPS_ORG_ID})`)
    }

    // 2. Add all users to HPS
    console.log("\n2. Adding users to HPS organization...")
    const users = db.prepare("SELECT id, role FROM users").all() as Array<{
      id: string
      role: string
    }>

    let added = 0
    let skipped = 0

    for (const user of users) {
      const existing = db
        .prepare(
          "SELECT id FROM organization_members WHERE organization_id = ? AND user_id = ?"
        )
        .get(HPS_ORG_ID, user.id)

      if (existing) {
        skipped++
      } else {
        db.prepare(
          `INSERT INTO organization_members (id, organization_id, user_id, role, joined_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(randomUUID(), HPS_ORG_ID, user.id, user.role, timestamp)
        added++
      }
    }

    console.log(`   Added ${added} user(s), skipped ${skipped}`)

    // 3. Update customers
    console.log("\n3. Updating customers...")
    const custResult = db
      .prepare("UPDATE customers SET organization_id = ? WHERE organization_id IS NULL")
      .run(HPS_ORG_ID)
    console.log(`   Updated ${custResult.changes} customer(s)`)

    // 4. Update vendors
    console.log("\n4. Updating vendors...")
    const vendResult = db
      .prepare("UPDATE vendors SET organization_id = ? WHERE organization_id IS NULL")
      .run(HPS_ORG_ID)
    console.log(`   Updated ${vendResult.changes} vendor(s)`)

    // 5. Update projects
    console.log("\n5. Updating projects...")
    const projResult = db
      .prepare("UPDATE projects SET organization_id = ? WHERE organization_id IS NULL")
      .run(HPS_ORG_ID)
    console.log(`   Updated ${projResult.changes} project(s)`)

    console.log("\nSummary:")
    console.log(`   Org: ${HPS_ORG_NAME} (${HPS_ORG_ID})`)
    console.log(`   Members: ${users.length} total (${added} new)`)
    console.log(`   Customers: ${custResult.changes} updated`)
    console.log(`   Vendors: ${vendResult.changes} updated`)
    console.log(`   Projects: ${projResult.changes} updated`)
  })

  try {
    tx()
    console.log("\nMigration completed successfully.")
  } catch (error) {
    console.error("\nMigration failed:", error)
    process.exit(1)
  } finally {
    db.close()
  }
}

main()
