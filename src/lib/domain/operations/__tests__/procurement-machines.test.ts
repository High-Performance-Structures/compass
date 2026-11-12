import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  automaticSourceSpellings,
  automaticStatusAfter,
  purchaseOrderAutomation,
  rfqAutomation,
} from "@/lib/domain/operations/procurement-machines"
import { RECORD_STATUS_REGISTRY } from "@/lib/domain/record-statuses/registry"
import { availableEvents, machineProblems } from "@/lib/shared/state-machine"

describe("RFQ status automation", () => {
  it("is well formed and uses built-in RFQ statuses only", () => {
    expect(machineProblems(rfqAutomation)).toEqual([])
    const builtIn = RECORD_STATUS_REGISTRY.rfq.statuses.map((status) => status.key)
    for (const state of rfqAutomation.states) expect(builtIn).toContain(state)
  })

  it("sends drafts and re-sends sent RFQs, nothing further along", () => {
    const send = { kind: "rfq", event: "send" } as const
    expect(automaticStatusAfter(send, "draft")).toBe("sent")
    expect(automaticStatusAfter(send, "sent")).toBe("sent")
    for (const status of ["response_received", "awarded", "declined", "complete", "closed", "void", "cancelled"]) {
      expect(automaticStatusAfter(send, status)).toBeNull()
    }
  })

  it("takes vendor answers only while the RFQ is out", () => {
    const quote = { kind: "rfq", event: "vendor_quote" } as const
    expect(automaticStatusAfter(quote, "sent")).toBe("response_received")
    expect(automaticStatusAfter(quote, "response_received")).toBe("response_received")
    expect(automaticStatusAfter({ kind: "rfq", event: "vendor_decline" }, "sent")).toBe("declined")
    for (const status of ["draft", "awarded", "declined", "complete", "closed", "void"]) {
      expect(automaticStatusAfter(quote, status)).toBeNull()
    }
  })

  it("lets staff record a response until the bid is awarded or the RFQ is closed", () => {
    const staffQuote = { kind: "rfq", event: "staff_quote" } as const
    expect(automaticStatusAfter(staffQuote, "declined")).toBe("response_received")
    expect(automaticStatusAfter(staffQuote, "awarded")).toBeNull()
    expect(automaticStatusAfter(staffQuote, "void")).toBeNull()
  })

  it("awards only a received response, and an awarded RFQ is never moved again", () => {
    expect(automaticStatusAfter({ kind: "rfq", event: "award" }, "response_received")).toBe("awarded")
    expect(automaticStatusAfter({ kind: "rfq", event: "award" }, "sent")).toBeNull()
    expect(availableEvents(rfqAutomation, "awarded")).toEqual([])
  })

  it("leaves company-added statuses alone", () => {
    for (const event of ["send", "vendor_quote", "vendor_decline", "staff_quote", "staff_decline", "award"] as const) {
      expect(automaticStatusAfter({ kind: "rfq", event }, "waiting_on_engineer")).toBeNull()
    }
  })
})

describe("purchase order status automation", () => {
  it("is well formed apart from approved, which only staff set", () => {
    expect(machineProblems(purchaseOrderAutomation)).toEqual([
      'state "approved" cannot be reached from "draft"',
    ])
    const builtIn = RECORD_STATUS_REGISTRY.purchase_order.statuses.map((status) => status.key)
    for (const state of purchaseOrderAutomation.states) expect(builtIn).toContain(state)
  })

  it("sends a draft or approved PO without downgrading later statuses", () => {
    const send = { kind: "purchase_order", event: "send" } as const
    expect(automaticStatusAfter(send, "draft")).toBe("sent")
    expect(automaticStatusAfter(send, "Approved")).toBe("sent")
    for (const status of ["sent", "ordered", "partially_received", "received", "complete", "closed", "void", "Cancelled", "on_hold"]) {
      expect(automaticStatusAfter(send, status)).toBeNull()
    }
  })

  it("matches the stored spelling it read, so compare-and-set finds the row", () => {
    const send = { kind: "purchase_order", event: "send" } as const
    expect(automaticSourceSpellings(send, " Draft")).toEqual(["draft", "approved", " Draft"])
    expect(automaticSourceSpellings(send, "void")).toEqual(["draft", "approved"])
  })
})

// ---------------------------------------------------------------------------
// Guard: RFQ and PO status writes go through the store's two status functions.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

/** The argument text of every call to `name(` in `source`. */
function callArguments(source: string, name: string): string[] {
  const calls: string[] = []
  let at = source.indexOf(`${name}(`)
  while (at >= 0) {
    let depth = 0
    let end = at + name.length
    for (; end < source.length; end++) {
      if (source[end] === "(") depth++
      if (source[end] === ")" && --depth === 0) break
    }
    calls.push(source.slice(at, end))
    at = source.indexOf(`${name}(`, end)
  }
  return calls
}

/** A call's text outside nested calls and nested objects: its arguments and their own keys. */
function topLevel(call: string): string {
  let parens = 0
  let braces = 0
  let kept = ""
  for (const char of call) {
    if (char === ")") parens--
    if (char === "}") braces--
    if (parens <= 1 && braces <= 1) kept += char
    if (char === "(") parens++
    if (char === "{") braces++
  }
  return kept
}

const GENERIC_UPDATES = ["operationUpdateQuery", "updateOperations", "updateOperationById", "updateOperationsReturning"]

// Files that set status through the generic update helpers for record types
// that are not RFQs or POs (to-dos, pay applications, Sage handoffs). A new
// file here needs a reason; RFQ and PO statuses never belong on this list.
const OTHER_RECORD_STATUS_WRITERS = new Set([
  "src/app/actions/pay-application-billing.ts",
  "src/app/actions/project-financial-workflows.ts",
  "src/app/actions/project-sage-handoff-review.ts",
  "src/app/actions/project-todos.ts",
  "src/app/actions/projects.ts",
  "src/lib/daily-logs/log-followups-server.ts",
])

describe("RFQ and purchase order status writes", () => {
  it("only the operations store updates project_operations", () => {
    const writers = sourceFiles("src").filter((file) =>
      /\.update\((schema\.)?projectOperations\)|UPDATE project_operations/.test(readFileSync(file, "utf8")),
    )
    expect(writers).toEqual(["src/lib/domain/operations/store.ts"])
  })

  it("no caller sets status through the generic update helpers outside the known non-procurement writers", () => {
    const offenders = sourceFiles("src").flatMap((file) => {
      if (file.startsWith("src/lib/domain/operations/store.ts") || OTHER_RECORD_STATUS_WRITERS.has(file)) return []
      const source = readFileSync(file, "utf8")
      return GENERIC_UPDATES.flatMap((name) => callArguments(source, name))
        .filter((call) => /[{,\s]status(:|,|\s*})/.test(topLevel(call)))
        .map((call) => `${file}: ${call.slice(0, 80)}`)
    })
    expect(offenders).toEqual([])
  })

  it("the store's procurement status writes are compare-and-set", () => {
    const store = readFileSync("src/lib/domain/operations/store.ts", "utf8")
    const staff = store.slice(store.indexOf("export async function setProcurementStatusByStaff"))
    expect(staff.slice(0, staff.indexOf("\n}\n"))).toContain("eq(projectOperations.status, input.expected)")
    const automatic = store.slice(store.indexOf("function automaticStatusUpdate"))
    const body = automatic.slice(0, automatic.indexOf("\n}\n"))
    expect(body).toContain("automaticStatusAfter(move.automation, move.stored)")
    expect(body).toContain("inArray(projectOperations.status, [...automaticSourceSpellings(")
  })
})
