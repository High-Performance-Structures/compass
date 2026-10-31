import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * Enforces the polling standard in docs/development/architecture-standards.md:
 * every network poll in the browser goes through useVisibleInterval
 * (src/hooks/use-visible-interval.ts), so hidden tabs stop polling and a tab
 * that missed a tick refreshes once when it is shown again. Data the
 * dashboard layout already loaded (projects, notifications) is read from its
 * provider, not fetched again.
 *
 * If this fails, use useVisibleInterval rather than adding to the allowlist.
 * The allowlist is only for timers that never touch the network (clocks,
 * animations, audio sampling, window checks) and for the hook itself; every
 * entry carries its reason and how many raw timers the file may hold.
 */

const ROOT = process.cwd()
const DIRS = ["src/components", "src/app", "src/hooks", "src/contexts"] as const

function sourceFiles(dir: string): readonly string[] {
  if (!existsSync(join(ROOT, dir))) return []
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === "__tests__" || entry === "node_modules") return []
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

const FILES = DIRS.flatMap((dir) => sourceFiles(dir)).map((path) => relative(ROOT, join(ROOT, path)))

type Allowed = { readonly count: number; readonly reason: string }

const RAW_INTERVAL_ALLOWLIST: Readonly<Record<string, Allowed>> = {
  "src/hooks/use-visible-interval.ts": { count: 0, reason: "the shared hook (it schedules with setTimeout; listed so it may switch back)" },
  "src/components/cherish/cherish-story-invitation.tsx": { count: 1, reason: "UI only: story progress bar animation" },
  "src/components/projects/project-audience-dashboard-photo.tsx": { count: 1, reason: "UI only: photo slideshow advance" },
  "src/components/projects/project-meetings-audience-button.tsx": { count: 1, reason: "UI only: clock tick for the Join window" },
  "src/components/dashboard/operational-dashboard.tsx": { count: 1, reason: "UI only: photo carousel advance" },
  "src/components/dashboard/portfolio-map/portfolio-weather-panel.tsx": { count: 1, reason: "UI only: weather animation step" },
  "src/components/voice/listening-room.tsx": { count: 1, reason: "UI only: one-second playback clock (the room poll uses the hook)" },
  "src/components/voice/listening-room-player.tsx": { count: 1, reason: "UI only: keeps the local player in step with the shared position" },
  "src/components/voice/voice-panel.tsx": { count: 1, reason: "UI only: checks whether the pop-out meeting window was closed" },
  "src/components/ai/audio-waveform.tsx": { count: 1, reason: "UI only: microphone waveform sampling" },
  "src/hooks/use-muted-speech-hint.ts": { count: 1, reason: "UI only: microphone level sampling while muted" },
  "src/hooks/use-music-ducking.ts": { count: 1, reason: "UI only: voice level sampling to duck music" },
  "src/hooks/use-voice-state.ts": {
    count: 1,
    reason: "live voice call: keeps participants in sync while connected, including in a background tab",
  },
  "src/components/conversations/member-sidebar.tsx": {
    count: 1,
    reason: "unused file, left for the dead-code cleanup; delete this entry with the file",
  },
}

function rawIntervalCount(path: string): number {
  return (readFileSync(join(ROOT, path), "utf8").match(/\bsetInterval\s*\(/g) ?? []).length
}

describe("polling standard", () => {
  it("polls only through useVisibleInterval", () => {
    const offenders = FILES.flatMap((path) => {
      const count = rawIntervalCount(path)
      const allowed = RAW_INTERVAL_ALLOWLIST[path]?.count ?? 0
      return count > allowed ? [`${path} (${count} setInterval, ${allowed} allowed)`] : []
    })
    expect(
      offenders,
      "Poll with useVisibleInterval from @/hooks/use-visible-interval (docs/development/architecture-standards.md)."
    ).toEqual([])
  })

  it("gives every allowlisted timer a written reason", () => {
    const missing = Object.entries(RAW_INTERVAL_ALLOWLIST)
      .filter(([, entry]) => entry.reason.trim().length < 10)
      .map(([path]) => path)
    expect(missing).toEqual([])
  })

  it("keeps the allowlist current", () => {
    // A file that no longer uses a raw timer should leave the list. Files
    // deleted elsewhere are skipped so cleanups do not have to touch this test.
    const stale = Object.entries(RAW_INTERVAL_ALLOWLIST)
      .filter(([path, entry]) => entry.count > 0 && existsSync(join(ROOT, path)) && rawIntervalCount(path) < entry.count)
      .map(([path]) => path)
    expect(stale, "Lower or remove these allowlist entries.").toEqual([])
  })

  it("reads layout-loaded projects from ProjectListProvider in client components", () => {
    const offenders = FILES.filter((path) => {
      if (!path.startsWith("src/components/") && !path.startsWith("src/hooks/")) return false
      const source = readFileSync(join(ROOT, path), "utf8")
      return /^["']use client["']/.test(source) && /\bgetProjects\s*\(/.test(source)
    })
    expect(offenders, "Use useProjectList() from @/components/project-list-provider.").toEqual([])
  })

  it("loads the notification center only through the shared store", () => {
    const allowed = new Set(["src/components/notifications/notification-center-provider.tsx"])
    const offenders = FILES.filter(
      (path) =>
        (path.startsWith("src/components/") || path.startsWith("src/hooks/")) &&
        !allowed.has(path) &&
        /\bgetNotificationCenter\s*\(/.test(readFileSync(join(ROOT, path), "utf8"))
    )
    expect(offenders, "Read notifications with useNotificationCenter or useNotificationInbox.").toEqual([])
  })
})
