const DB_PATH = process.env.LOCAL_DB_PATH || "local.db"

let db: SqliteDatabase | null = null

type SqlValue = string | number | Uint8Array | null

type SqliteRunResult = {
    changes: number
    lastInsertRowid: number | bigint
}

type SqliteStatement = {
    get: (...params: readonly SqlValue[]) => unknown
    all: (...params: readonly SqlValue[]) => unknown[]
    run: (...params: readonly SqlValue[]) => SqliteRunResult
    raw: (raw?: boolean) => SqliteStatement
}

type SqliteDatabase = {
    prepare: (sql: string) => SqliteStatement
    exec: (sql: string) => void
    transaction: <T>(fn: () => T) => () => T
    close: () => void
}

type CompassCloudflareContext = {
    env: CloudflareEnv
    ctx: {
        waitUntil: (promise: Promise<unknown>) => void
    }
    cf: unknown
}

function toSqlValue(value: unknown): SqlValue {
    if (
        typeof value === "string" ||
        typeof value === "number" ||
        value instanceof Uint8Array ||
        value === null
    ) {
        return value
    }

    if (typeof value === "boolean") {
        return value ? 1 : 0
    }

    if (value instanceof Date) {
        return value.toISOString()
    }

    return String(value)
}

function toSqlValues(values: readonly unknown[]): readonly SqlValue[] {
    return values.map(toSqlValue)
}

async function getLocalDb(): Promise<SqliteDatabase> {
    if (!db) {
        const Database = (await import("better-sqlite3")).default
        const initializedDb = new Database(DB_PATH)
        db = initializedDb
        return initializedDb
    }
    return db
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
    private db: SqliteDatabase
    private query: string
    private boundValues: unknown[] = []

    constructor(db: SqliteDatabase, query: string) {
        this.db = db
        this.query = query
    }

    bind(...values: unknown[]): this {
        this.boundValues = values
        return this
    }

    async first<T = unknown>(): Promise<T | null> {
        const stmt = this.db.prepare(this.query)
        const row = stmt.get(...toSqlValues(this.boundValues))
        return row ? (row as T) : null
    }

    async run(): Promise<D1Result> {
        return this.runSync()
    }

    runSync(): D1Result {
        const results: unknown[] = []
        const result = this.db
            .prepare(this.query)
            .run(...toSqlValues(this.boundValues))
        return {
            results,
            success: true,
            meta: {
                duration: 0,
                changes: result.changes,
                last_row_id: Number(result.lastInsertRowid),
                rows_read: 0,
                rows_written: result.changes,
            },
        }
    }

    async executeBatch<T = unknown>(): Promise<D1Result<T>> {
        return this.executeBatchSync<T>()
    }

    executeBatchSync<T = unknown>(): D1Result<T> {
        if (this.returnsRows()) {
            return this.allSync<T>()
        }

        const result = this.runSync()
        return {
            results: [],
            success: result.success,
            meta: result.meta,
        }
    }

    async all<T = unknown>(): Promise<D1Result<T>> {
        return this.allSync<T>()
    }

    allSync<T = unknown>(): D1Result<T> {
        const results = this.db
            .prepare(this.query)
            .all(...toSqlValues(this.boundValues)) as T[]
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
        return this.db
            .prepare(this.query)
            .raw(true)
            .all(...toSqlValues(this.boundValues)) as T[]
    }

    private returnsRows(): boolean {
        const normalizedQuery = this.query.trim().toLowerCase()
        return (
            /^(select|pragma|with|explain)\b/.test(normalizedQuery) ||
            /\breturning\b/.test(normalizedQuery)
        )
    }
}

class LocalD1Database {
    constructor(private db: SqliteDatabase) {}

    prepare(query: string): LocalPreparedStatement {
        return new LocalPreparedStatement(this.db, query)
    }

    async batch<T = unknown>(
        statements: LocalPreparedStatement[]
    ): Promise<D1Result<T>[]> {
        const runBatch = this.db.transaction(() =>
            statements.map((stmt) => stmt.executeBatchSync<T>())
        )
        return runBatch()
    }

    async exec(query: string): Promise<D1Result> {
        this.db.exec(query)
        return {
            results: [],
            success: true,
            meta: {
                duration: 0,
                changes: 0,
                last_row_id: 0,
                rows_read: 0,
                rows_written: 0,
            },
        }
    }

    async dump(): Promise<ArrayBuffer> {
        const { readFile } = await import("fs/promises")
        const data = await readFile(DB_PATH)
        return data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength
        )
    }
}

function createUnavailableFetcher(name: string): Fetcher {
    return {
        fetch: async () =>
            new Response(`${name} is unavailable in local development`, {
                status: 501,
            }),
        connect: () => {
            throw new Error(`${name} sockets are unavailable in local development`)
        },
    }
}

function createLocalEnv(DB: D1Database): CloudflareEnv {
    const localWorkOsRedirectUri =
        process.env.WORKOS_REDIRECT_URI ??
        process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ??
        "http://localhost:3000/callback"

    const localEnv = {
        WORKOS_REDIRECT_URI: localWorkOsRedirectUri,
        WORKOS_API_KEY: process.env.WORKOS_API_KEY ?? "placeholder",
        WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID ?? "placeholder",
        WORKOS_COOKIE_PASSWORD:
            process.env.WORKOS_COOKIE_PASSWORD ??
            "placeholder-local-cookie-password-32",
        NEXT_PUBLIC_WORKOS_REDIRECT_URI:
            process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ??
            "http://localhost:3000/callback",
        NETSUITE_ACCOUNT_ID: process.env.NETSUITE_ACCOUNT_ID ?? "",
        NETSUITE_CLIENT_ID: process.env.NETSUITE_CLIENT_ID ?? "",
        NETSUITE_CLIENT_SECRET: process.env.NETSUITE_CLIENT_SECRET ?? "",
        NETSUITE_REDIRECT_URI:
            process.env.NETSUITE_REDIRECT_URI ??
            "http://localhost:3000/api/netsuite/callback",
        NETSUITE_TOKEN_ENCRYPTION_KEY:
            process.env.NETSUITE_TOKEN_ENCRYPTION_KEY ?? "",
        NETSUITE_CONCURRENCY_LIMIT:
            process.env.NETSUITE_CONCURRENCY_LIMIT ?? "15",
        GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "",
        GITHUB_REPO:
            process.env.GITHUB_REPO ?? "High-Performance-Structures/compass",
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "",
        FOXIT_ESIGN_CLIENT_ID: process.env.FOXIT_ESIGN_CLIENT_ID ?? "",
        FOXIT_ESIGN_CLIENT_SECRET: process.env.FOXIT_ESIGN_CLIENT_SECRET ?? "",
        FOXIT_ESIGN_WEBHOOK_SECRET:
            process.env.FOXIT_ESIGN_WEBHOOK_SECRET ?? "",
        DB,
        BROWSER: createUnavailableFetcher("BROWSER"),
        WORKER_SELF_REFERENCE: createUnavailableFetcher(
            "WORKER_SELF_REFERENCE"
        ) as CloudflareEnv["WORKER_SELF_REFERENCE"],
        AI: {
            run: async () => {
                throw new Error("Cloudflare AI is unavailable in local development")
            },
        } as unknown as Ai,
        IMAGES: {
            input: async () => {
                throw new Error(
                    "Cloudflare Images is unavailable in local development"
                )
            },
        } as unknown as ImagesBinding,
        ASSETS: createUnavailableFetcher("ASSETS"),
    }

    for (const key of [
        "JARVIS_BRIDGE_SECRET",
        "JARVIS_BRIDGE_SECONDARY_SECRET",
        "JARVIS_BRIDGE_ORGANIZATION_ID",
        "JARVIS_SERVICE_USER_ID",
        "JARVIS_AGENT_BRIDGE_ENABLED",
    ]) {
        const value = process.env[key]
        if (value) Reflect.set(localEnv, key, value)
    }

    return localEnv as unknown as CloudflareEnv
}

export async function getCloudflareContext(): Promise<CompassCloudflareContext> {
    const localDb = await getLocalDb()
    const d1 = new LocalD1Database(localDb) as unknown as D1Database

    return {
        env: createLocalEnv(d1),
        ctx: {
            waitUntil: () => {},
        },
        cf: {},
    }
}
