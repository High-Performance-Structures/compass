import initSqlJs, { Database as SqlJsDatabase } from "sql.js"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { createRequire } from "module"
import { getDb } from "@/db"

const require = createRequire(import.meta.url)
const sqlJsWasm = require.resolve("sql.js/dist/sql-wasm.wasm")

const DB_PATH = process.env.LOCAL_DB_PATH || "local.db"

let sqlJs: Awaited<ReturnType<typeof initSqlJs>> | null = null
let db: SqlJsDatabase | null = null

async function getLocalDb(): Promise<SqlJsDatabase> {
    if (!sqlJs) {
        sqlJs = await initSqlJs({
            locateFile: (file: string) => {
                if (file.endsWith(".wasm")) {
                    return sqlJsWasm
                }
                return file
            },
        })
    }
    if (!db) {
        if (existsSync(DB_PATH)) {
            const buffer = readFileSync(DB_PATH)
            db = new sqlJs.Database(buffer)
        } else {
            db = new sqlJs.Database()
        }
    }
    return db
}

function saveDb(db: SqlJsDatabase) {
    const data = db.export()
    const buffer = Buffer.from(data)
    writeFileSync(DB_PATH, buffer)
}

interface D1Result<T = unknown> {
    results: T[]
    success: boolean
    meta: {
        duration: number
        changes: number
        last_row_id: number
        rows_read: number
        rows_written: number
    }
}

class LocalPreparedStatement {
    private db: SqlJsDatabase
    private query: string
    private boundValues: unknown[] = []

    constructor(db: SqlJsDatabase, query: string) {
        this.db = db
        this.query = query
    }

    bind(...values: unknown[]): this {
        this.boundValues = values
        return this
    }

    async first<T = unknown>(): Promise<T | null> {
        const stmt = this.db.prepare(this.query)
        if (this.boundValues.length > 0) {
            stmt.bind(this.boundValues as number[])
        }
        if (stmt.step()) {
            const row = stmt.getAsObject() as T
            stmt.free()
            return row
        }
        stmt.free()
        return null
    }

    async run(): Promise<D1Result> {
        this.db.run(this.query, this.boundValues as number[])
        saveDb(this.db)
        return {
            results: [],
            success: true,
            meta: {
                duration: 0,
                changes: this.db.getRowsModified(),
                last_row_id: Number(this.db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] || 0),
                rows_read: 0,
                rows_written: this.db.getRowsModified(),
            },
        }
    }

    async all<T = unknown>(): Promise<D1Result<T>> {
        const stmt = this.db.prepare(this.query)
        if (this.boundValues.length > 0) {
            stmt.bind(this.boundValues as number[])
        }
        const results: T[] = []
        while (stmt.step()) {
            results.push(stmt.getAsObject() as T)
        }
        stmt.free()
        return {
            results,
            success: true,
            meta: {
                duration: 0,
                changes: 0,
                last_row_id: 0,
                rows_read: results.length,
                rows_written: 0,
            },
        }
    }

    async raw<T = unknown>(): Promise<T[]> {
        const results = this.db.exec(this.query, this.boundValues as number[])
        return results[0]?.values as T[] ?? []
    }
}

class LocalD1Database {
    constructor(private db: SqlJsDatabase) {}

    prepare(query: string): LocalPreparedStatement {
        return new LocalPreparedStatement(this.db, query)
    }

    async batch<T = unknown>(
        statements: LocalPreparedStatement[]
    ): Promise<D1Result<T>[]> {
        const results: D1Result<T>[] = []
        for (const stmt of statements) {
            results.push(await stmt.all<T>())
        }
        return results
    }

    async exec(query: string): Promise<D1Result> {
        this.db.run(query)
        saveDb(this.db)
        return {
            results: [],
            success: true,
            meta: {
                duration: 0,
                changes: this.db.getRowsModified(),
                last_row_id: 0,
                rows_read: 0,
                rows_written: this.db.getRowsModified(),
            },
        }
    }

    async dump(): Promise<ArrayBuffer> {
        const data = this.db.export()
        return data.buffer as ArrayBuffer
    }
}

export async function getCloudflareContext(): Promise<{
    env: {
        DB: D1Database
        [key: string]: unknown
    }
    ctx: {
        waitUntil: (promise: Promise<unknown>) => void
    }
    cf: unknown
}> {
    const localDb = await getLocalDb()
    const d1 = new LocalD1Database(localDb) as unknown as D1Database

    return {
        env: {
            DB: d1,
        },
        ctx: {
            waitUntil: () => {},
        },
        cf: {},
    }
}
