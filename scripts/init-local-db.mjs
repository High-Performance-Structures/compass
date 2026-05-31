import Database from "better-sqlite3"
import { readFileSync, readdirSync } from "fs"
import { join } from "path"

const DB_PATH = process.env.LOCAL_DB_PATH || "local.db"
const MIGRATIONS_DIR = join(process.cwd(), "drizzle")
const MIGRATIONS_TABLE = "__compass_local_migrations"

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

function tableExists(db, tableName) {
    const row = db
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
        )
        .get(tableName)
    return row !== undefined
}

function columnExists(db, tableName, columnName) {
    if (!tableExists(db, tableName)) return false
    return db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all()
        .some((column) => column.name === columnName)
}

function hasLocalSchema(db) {
    const row = db
        .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table'
               AND name NOT LIKE 'sqlite_%'
               AND name != ?
             LIMIT 1`
        )
        .get(MIGRATIONS_TABLE)
    return row !== undefined
}

function hasLatestKnownSchema(db) {
    return columnExists(
        db,
        "daily_log_photos",
        "schedule_phase_override"
    )
}

function markMigrationApplied(db, migration) {
    db.prepare(
        `INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES (?, ?)`
    ).run(migration, new Date().toISOString())
}

function markMigrationsApplied(db, migrations) {
    const markAll = db.transaction((migrationFiles) => {
        for (const migration of migrationFiles) {
            markMigrationApplied(db, migration)
        }
    })
    markAll(migrations)
}

function main() {
    const db = new Database(DB_PATH)
    const migrations = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql") && !f.includes("seed"))
        .sort()

    ensureMigrationsTable(db)
    const applied = appliedMigrationNames(db)

    if (applied.size === 0 && hasLocalSchema(db)) {
        if (!hasLatestKnownSchema(db)) {
            throw new Error(
                `${DB_PATH} already has local tables but is missing migration metadata. ` +
                    "Delete the database or finish the missing migrations manually before rerunning db:init-local."
            )
        }

        markMigrationsApplied(db, migrations)
        console.log(
            `Recorded ${migrations.length} existing migrations for ${DB_PATH}.`
        )
    }

    const updatedApplied = appliedMigrationNames(db)
    const pendingMigrations = migrations.filter(
        (migration) => !updatedApplied.has(migration)
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

            console.log(`  ${migration}`)
            applyMigration()
        }
    } finally {
        db.close()
    }

    console.log("Done!")
}

main()
