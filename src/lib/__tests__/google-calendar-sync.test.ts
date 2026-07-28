import { describe, expect, it } from "vitest"

import {
  GOOGLE_CALENDAR_SCOPES,
  getGoogleCalendarOAuthConfig,
} from "@/lib/google/calendar/config"
import {
  buildGoogleCalendarAuthorizationUrl,
  hasRequiredGoogleCalendarScopes,
} from "@/lib/google/calendar/oauth"
import {
  calendarDetailLevel,
  decideGoogleCalendarSyncAction,
  googleEventIdForCompass,
} from "@/lib/google/calendar/sync-policy"

describe("Google Calendar OAuth configuration", () => {
  it("fails closed when required secrets are missing", () => {
    const result = getGoogleCalendarOAuthConfig({
      GOOGLE_OAUTH_CLIENT_ID: "",
      GOOGLE_OAUTH_CLIENT_SECRET: "",
      GOOGLE_OAUTH_REDIRECT_URI: "",
      GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: "",
    })

    expect(result.configured).toBe(false)
    if (!result.configured) {
      expect(result.missing).toContain("GOOGLE_OAUTH_CLIENT_ID")
      expect(result.missing).toContain("GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY")
    }
  })

  it("builds a consent URL with state and calendar-only scopes", () => {
    const url = new URL(
      buildGoogleCalendarAuthorizationUrl(
        {
          clientId: "client-id",
          clientSecret: "client-secret",
          redirectUri: "https://compass.example/api/google/calendar/callback",
          tokenEncryptionKey: "encryption-key",
        },
        "csrf-state",
        "staff@example.com",
      ),
    )

    expect(url.searchParams.get("state")).toBe("csrf-state")
    expect(url.searchParams.get("access_type")).toBe("offline")
    expect(url.searchParams.get("login_hint")).toBe("staff@example.com")
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      ...GOOGLE_CALENDAR_SCOPES,
    ])
    expect(url.searchParams.get("scope")).not.toContain(
      "https://www.googleapis.com/auth/tasks",
    )
  })

  it("rejects partial Google grants", () => {
    expect(hasRequiredGoogleCalendarScopes([...GOOGLE_CALENDAR_SCOPES])).toBe(
      true,
    )
    expect(
      hasRequiredGoogleCalendarScopes(
        GOOGLE_CALENDAR_SCOPES.filter(
          (scope) =>
            scope !==
            "https://www.googleapis.com/auth/calendar.events",
        ),
      ),
    ).toBe(false)
  })
})

describe("calendar privacy", () => {
  it("hides project events from users without project access", () => {
    expect(
      calendarDetailLevel({
        visibility: "organization",
        viewerIsOwner: false,
        viewerIsParticipant: false,
        viewerHasProjectAccess: false,
        hasProjectScope: true,
      }),
    ).toBe("hidden")
  })

  it("shows private details to an attendee", () => {
    expect(
      calendarDetailLevel({
        visibility: "private",
        viewerIsOwner: false,
        viewerIsParticipant: true,
        viewerHasProjectAccess: true,
        hasProjectScope: false,
      }),
    ).toBe("full")
  })

  it("reduces participant-only details to busy for other staff", () => {
    expect(
      calendarDetailLevel({
        visibility: "participants",
        viewerIsOwner: false,
        viewerIsParticipant: false,
        viewerHasProjectAccess: true,
        hasProjectScope: false,
      }),
    ).toBe("busy")
  })
})

describe("Google Calendar sync decisions", () => {
  it("pushes Compass-only changes in two-way mode", () => {
    expect(
      decideGoogleCalendarSyncAction({
        direction: "two_way",
        compassChanged: true,
        googleChanged: false,
        googleDeleted: false,
      }),
    ).toBe("push")
  })

  it("pulls Google-only changes in two-way mode", () => {
    expect(
      decideGoogleCalendarSyncAction({
        direction: "two_way",
        compassChanged: false,
        googleChanged: true,
        googleDeleted: false,
      }),
    ).toBe("pull")
  })

  it("restores Google-authoritative records after local drift", () => {
    expect(
      decideGoogleCalendarSyncAction({
        direction: "pull",
        compassChanged: true,
        googleChanged: false,
        googleDeleted: false,
      }),
    ).toBe("pull")
  })

  it("does not silently overwrite concurrent edits", () => {
    expect(
      decideGoogleCalendarSyncAction({
        direction: "two_way",
        compassChanged: true,
        googleChanged: true,
        googleDeleted: false,
      }),
    ).toBe("conflict")
  })
})

describe("Google Calendar event IDs", () => {
  it("creates deterministic Google-compatible IDs", async () => {
    const first = await googleEventIdForCompass(
      "work_calendar_event",
      "event-123",
      "connection-456",
    )
    const second = await googleEventIdForCompass(
      "work_calendar_event",
      "event-123",
      "connection-456",
    )

    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-v]{5,1024}$/)
  })

  it("separates IDs by connection and source type", async () => {
    const eventId = await googleEventIdForCompass(
      "work_calendar_event",
      "record-1",
      "connection-1",
    )
    const taskId = await googleEventIdForCompass(
      "task",
      "record-1",
      "connection-1",
    )
    const otherAccountId = await googleEventIdForCompass(
      "work_calendar_event",
      "record-1",
      "connection-2",
    )

    expect(new Set([eventId, taskId, otherAccountId]).size).toBe(3)
  })
})
