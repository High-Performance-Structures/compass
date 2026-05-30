import Database from "better-sqlite3"
import { readFileSync, readdirSync } from "fs"
import { join } from "path"

const DB_PATH = process.env.LOCAL_DB_PATH || "local.db"
const MIGRATIONS_DIR = join(process.cwd(), "drizzle")

function main() {
    const db = new Database(DB_PATH)
    const migrations = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql") && !f.includes("seed"))
        .sort()

    console.log(`Running ${migrations.length} migrations on ${DB_PATH}...`)

    try {
        for (const migration of migrations) {
            const sql = readFileSync(join(MIGRATIONS_DIR, migration), "utf-8")
            console.log(`  ${migration}`)
            db.exec(sql)
        }
    } finally {
        db.close()
    }

    console.log("Done!")
}

main()
