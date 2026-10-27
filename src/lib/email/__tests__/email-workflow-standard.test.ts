import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * Enforces docs/development/email-workflows.md: one way to email people
 * outside the company, with tracked replies, Activity logging, and the
 * shared To/Cc picker. If one of these fails, follow that document rather
 * than adding to an allowlist; any exception needs a reason next to it.
 */

const ROOT = process.cwd()

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === "__tests__" || entry === "node_modules") return []
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
}

const FILES = [...sourceFiles("src/app"), ...sourceFiles("src/lib"), ...sourceFiles("src/components")].map((path) =>
  relative(ROOT, join(ROOT, path))
)

/** Mail that is not about a record and expects no reply. */
const UNTRACKED_SENDERS: Readonly<Record<string, string>> = {
  "src/lib/email/compass-email.ts": "defines sendCompassEmail",
  "src/lib/email/tracked-send.ts": "the tracked sender itself",
  "src/lib/notifications/create-event.ts": "notification emails to staff",
  "src/app/actions/project-email.ts": "project email keeps its own conversation reply thread",
  "src/lib/email/invitation-delivery.ts": "durable account invitation welcome delivery",
  "src/app/actions/greeting-cards.ts": "greeting cards",
  "src/app/actions/owner-document-notices.ts": "notification copies to owner portal users",
}

/** Compose UIs with their own recipient control. */
const OWN_RECIPIENT_UI: Readonly<Record<string, string>> = {
  "src/components/correspondence/project-email-composer.tsx": "project email has To/Cc/Bcc with directory search",
}

describe("email workflow standard", () => {
  it("sends outside email through sendTrackedEmail", () => {
    const offenders = FILES.filter(
      (path) => /\bsendCompassEmail\s*\(/.test(read(path)) && !(path in UNTRACKED_SENDERS)
    )
    expect(
      offenders,
      "Use sendTrackedEmail so replies come back to the record (docs/development/email-workflows.md)."
    ).toEqual([])
  })

  it("records an Activity event wherever a tracked email is sent", () => {
    const missing = FILES.filter(
      (path) =>
        path !== "src/lib/email/tracked-send.ts" &&
        /\bsendTrackedEmail\s*\(/.test(read(path)) &&
        !/\brecordActivityEvent\s*\(/.test(read(path))
    )
    expect(missing, "Log each send with recordActivityEvent.").toEqual([])
  })

  it("does not hand users mailto drafts for record emails", () => {
    const offenders = FILES.filter(
      (path) => path.startsWith("src/app/actions/") && /trackedMailtoHref|mailtoHref/.test(read(path))
    )
    expect(offenders, "Send from Compass instead of opening the user's mail app.").toEqual([])
  })

  it("uses the shared To/Cc picker in every email compose dialog", () => {
    const composers = FILES.filter(
      (path) =>
        path.startsWith("src/components/") &&
        /import \{[^}]*\bsend[A-Za-z]*Email\b[^}]*\} from "@\/app\/actions/.test(read(path))
    )
    expect(composers.length).toBeGreaterThan(0)
    const offenders = composers.filter((path) => {
      const source = read(path)
      return !source.includes("<EmailRecipientPicker") && !source.includes("<TemplateEmailMenu") && !(path in OWN_RECIPIENT_UI)
    })
    expect(offenders, "Use EmailRecipientPicker for To and Cc.").toEqual([])
    expect(read("src/components/email/template-email-menu.tsx")).toContain("<EmailRecipientPicker")
  })
})
