import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { VIEW_AS_COOKIE } from "@/lib/view-as/constants"
import { ViewAsReadOnlyError } from "@/lib/view-as/write-guard"

/*
 * The central chokepoint: every server action, API route and page reaches
 * D1 through getCloudflareContext(), so a View as request must get read-only
 * bindings there, and only the View as module and auth may ask for the real
 * ones.
 */

const state = vi.hoisted(() => ({ cookies: new Map<string, string>(), ran: [] as string[], serverAction: true }))

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (state.cookies.has(name) ? { value: state.cookies.get(name) } : undefined) }),
  headers: async () => ({ has: (name: string) => name === "next-action" && state.serverAction }),
}))

function statement(sql: string): D1PreparedStatement {
  const run = async () => {
    state.ran.push(sql)
    return { success: true, results: [], meta: {} }
  }
  return { bind: () => statement(sql), run, all: run, first: run, raw: run } as unknown as D1PreparedStatement
}

vi.mock("@/lib/cloudflare-context", () => ({
  getCloudflareContext: async () => ({
    env: { DB: { prepare: statement, batch: async () => [], exec: async () => ({}) } },
    ctx: { waitUntil: () => undefined },
    cf: null,
  }),
}))

const { getCloudflareContext, getUnguardedCloudflareContext } = await import("@/lib/db")

describe("getCloudflareContext during View as", () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    state.cookies.clear()
    state.ran = []
    state.serverAction = true
    globalThis.fetch = originalFetch
  })

  it("writes normally without the cookie", async () => {
    vi.stubEnv("NODE_ENV", "development")
    const { env } = await getCloudflareContext()
    await env.DB.prepare("insert into notes values (1)").run()
    expect(state.ran).toEqual(["insert into notes values (1)"])
    vi.unstubAllEnvs()
  })

  it("drops writes quietly while a page renders, so the screen still shows", async () => {
    vi.stubEnv("NODE_ENV", "development")
    state.cookies.set(VIEW_AS_COOKIE, "any")
    state.serverAction = false
    const { env } = await getCloudflareContext()
    await expect(env.DB.prepare("update notifications set read_at = ?").bind("now").run()).resolves.toMatchObject({ success: true })
    expect(state.ran).toEqual([])
    vi.unstubAllEnvs()
  })

  it("rejects writes from a server action once the cookie is present, even an invalid one", async () => {
    vi.stubEnv("NODE_ENV", "development")
    state.cookies.set(VIEW_AS_COOKIE, "not-even-a-valid-token")
    const { env } = await getCloudflareContext()
    await expect(env.DB.prepare("insert into notes values (1)").run()).rejects.toBeInstanceOf(ViewAsReadOnlyError)
    await env.DB.prepare("select 1").all()
    expect(state.ran).toEqual(["select 1"])
    // The View as module's own escape hatch still writes (audit, sign-in housekeeping).
    const raw = await getUnguardedCloudflareContext()
    await raw.env.DB.prepare("insert into activity_events values (1)").run()
    expect(state.ran).toEqual(["select 1", "insert into activity_events values (1)"])
    vi.unstubAllEnvs()
  })
})

const ALLOWED_UNGUARDED = new Set([
  "src/lib/db.ts",
  "src/lib/auth.ts",
  "src/lib/view-as/service.ts",
])

// Read every source file once; both scans below share it.
let sourceTexts: readonly (readonly [string, string])[] | null = null
function sources(): readonly (readonly [string, string])[] {
  const root = process.cwd()
  sourceTexts ??= sourceFiles(join(root, "src")).map((path) => [relative(root, path), readFileSync(path, "utf8")] as const)
  return sourceTexts
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === "__tests__" || entry === "node_modules") return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

describe("direct Cloudflare context imports", () => {
  // Only db.ts may read the bindings from OpenNext directly; github.ts reads
  // a secret only, and the platform provider passes D1 through the View as
  // guard (src/lib/view-as/guarded-binding.ts).
  const ALLOWED_DIRECT = new Set(["src/lib/db.ts", "src/app/actions/github.ts", "src/db/provider/d1-provider.ts"])

  it("go through src/lib/db.ts", { timeout: 60_000 }, () => {
    const direct = sources()
      .filter(([, text]) => text.includes("@opennextjs/cloudflare"))
      .map(([path]) => path)
    expect(direct.filter((path) => !ALLOWED_DIRECT.has(path))).toEqual([])
  })

  it("the platform provider guards D1 during View as", () => {
    const provider = readFileSync(join(process.cwd(), "src/db/provider/d1-provider.ts"), "utf8")
    expect(provider).toContain("viewAsGuardedD1")
  })
})

describe("getUnguardedCloudflareContext", () => {
  it("is used only by the View as module and auth", { timeout: 60_000 }, () => {
    const users = sources()
      .filter(([, text]) => text.includes("getUnguardedCloudflareContext"))
      .map(([path]) => path)
    expect(users.filter((path) => !ALLOWED_UNGUARDED.has(path))).toEqual([])
  })
})
