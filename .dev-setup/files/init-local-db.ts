import initSqlJs from "sql.js"
import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const sqlJsWasm = require.resolve("sql.js/dist/sql-wasm.wasm")

const DB_PATH = process.env.LOCAL_DB_PATH || "local.db"
const MIGRATIONS_DIR = join(process.cwd(), "drizzle")

async function main() {
    const sqlJs = await initSqlJs({
        locateFile: (file: string) => {
            if (file.endsWith(".wasm")) {
                return sqlJsWasm
            }
            return file
        },
    })

    let db: ReturnType<typeof sqlJs.Database>
    if (existsSync(DB_PATH)) {
        const buffer = readFileSync(DB_PATH)
        db = new sqlJs.Database(buffer)
    } else {
        db = new sqlJs.Database()
    }

    const migrations = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql") && !f.includes("seed"))
        .sort()

    console.log(`Running ${migrations.length} migrations on ${DB_PATH}...`)

    for (const migration of migrations) {
        const sql = readFileSync(join(MIGRATIONS_DIR, migration), "utf-8")
        console.log(`  ${migration}`)
        db.run(sql)
    }

    const data = db.export()
    const buffer = Buffer.from(data)
    writeFileSync(DB_PATH, buffer)

    console.log("Done!")
}

main().catch(console.error)
