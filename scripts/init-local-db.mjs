import Database from "better-sqlite3"
import { readFileSync, readdirSync } from "fs"
import { join } from "path"

const DB_PATH = process.env.LOCAL_DB_PATH || "local.db"
const MIGRATIONS_DIR = join(process.cwd(), "drizzle")
const MIGRATIONS_TABLE = "__compass_local_migrations"

function isAlreadyAppliedError(error) {
    if (!(error instanceof Error)) return false
    const message = error.message.toLowerCase()
    return (
        message.includes("already exists") ||
        message.includes("duplicate column name")
    )
}

function ensureMigrationsTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
            name text PRIMARY KEY NOT NULL,
            applied_at text NOT NULL
        )
    `)
}

function appliedMigrationNames(db) {
    return new Set(
        db
            .prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`)
            .all()
            .map((row) => row.name)
    )
}

function markMigrationApplied(db, migration) {
    db.prepare(
        `INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES (?, ?)`
    ).run(migration, new Date().toISOString())
}

function main() {
    const db = new Database(DB_PATH)
    const migrations = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql") && !f.includes("seed"))
        .sort()

    ensureMigrationsTable(db)
    const applied = appliedMigrationNames(db)
    const pendingMigrations = migrations.filter(
        (migration) => !applied.has(migration)
    )

    console.log(
        `Running ${pendingMigrations.length} of ${migrations.length} migrations on ${DB_PATH}...`
    )

    try {
        for (const migration of pendingMigrations) {
            const sql = readFileSync(join(MIGRATIONS_DIR, migration), "utf-8")
            const applyMigration = db.transaction(() => {
                db.exec(sql)
                markMigrationApplied(db, migration)
            })

            try {
                console.log(`  ${migration}`)
                applyMigration()
            } catch (error) {
                if (!isAlreadyAppliedError(error)) {
                    throw error
                }

                console.log(`  ${migration} already applied; marking complete`)
                markMigrationApplied(db, migration)
            }
        }
    } finally {
        db.close()
    }

    console.log("Done!")
}

main()
