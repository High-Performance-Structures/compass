import { afterEach, describe, expect, it } from "vitest"

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
import {
  addGoogleCalendarToList,
  createGoogleCalendar,
  parseGoogleCalendarEvent,
} from "@/lib/google/calendar/client"
import {
  canConnectGoogleCalendar,
  canManageOrganizationCalendars,
  canWriteGoogleCalendar,
} from "@/lib/google/calendar/policy"
import {
  canDeleteGoogleProjectCalendar,
  canEnableGoogleProjectCalendar,
  googleProjectCalendarAclRole,
} from "@/lib/google/calendar/project-policy"

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

  it("accepts Google's canonical userinfo email scope", () => {
    expect(
      hasRequiredGoogleCalendarScopes([
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/calendar.calendarlist",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.app.created",
        "https://www.googleapis.com/auth/calendar.acls",
      ]),
    ).toBe(true)
  })
})

describe("managed Google Calendar API requests", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("creates an app-owned secondary calendar", async () => {
    let requestUrl = ""
    let requestMethod = ""
    let requestBody = ""
    globalThis.fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      requestUrl = input.toString()
      requestMethod = init?.method ?? "GET"
      requestBody = typeof init?.body === "string" ? init.body : ""
      return Response.json({
        id: "project-calendar@example.com",
        summary: "Compass – 24-100 Smith",
        description: "Managed by Compass",
        timeZone: "America/Denver",
      })
    }

    const calendar = await createGoogleCalendar("access-token", {
      summary: "Compass – 24-100 Smith",
      description: "Managed by Compass",
      timeZone: "America/Denver",
    })

    expect(requestUrl).toBe("https://www.googleapis.com/calendar/v3/calendars")
    expect(requestMethod).toBe("POST")
    expect(JSON.parse(requestBody)).toEqual({
      summary: "Compass – 24-100 Smith",
      description: "Managed by Compass",
      timeZone: "America/Denver",
    })
    expect(calendar.id).toBe("project-calendar@example.com")
  })

  it("treats an existing user subscription as success", async () => {
    globalThis.fetch = async (): Promise<Response> =>
      Response.json(
        { error: { message: "Calendar already exists in calendar list." } },
        { status: 409 },
      )

    await expect(
      addGoogleCalendarToList("access-token", "project-calendar@example.com"),
    ).resolves.toBeUndefined()
  })
})

describe("managed project calendar policy", () => {
  it("allows office staff, but not field-only or external roles, to enable calendars", () => {
    expect(canEnableGoogleProjectCalendar("office")).toBe(true)
    expect(canEnableGoogleProjectCalendar("project_manager")).toBe(true)
    expect(canEnableGoogleProjectCalendar("field_superintendent")).toBe(false)
    expect(canEnableGoogleProjectCalendar("owner")).toBe(false)
  })

  it("reserves destructive calendar controls for administrators", () => {
    expect(canDeleteGoogleProjectCalendar("admin")).toBe(true)
    expect(canDeleteGoogleProjectCalendar("office")).toBe(false)
  })

  it("maps office members to event writers and other project members to readers", () => {
    expect(googleProjectCalendarAclRole("project_manager")).toBe(
      "writerWithoutPrivateAccess",
    )
    expect(googleProjectCalendarAclRole("subcontractor")).toBe("reader")
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

describe("managed Google Calendar policy", () => {
  it("lets developers manage a shared organization calendar", () => {
    expect(
      canConnectGoogleCalendar({ userId: "developer-1", role: "developer" }),
    ).toBe(true)
    expect(canManageOrganizationCalendars("developer")).toBe(true)
    expect(canManageOrganizationCalendars("office")).toBe(false)
  })

  it("requires Google writer access for Compass destinations", () => {
    expect(canWriteGoogleCalendar("owner")).toBe(true)
    expect(canWriteGoogleCalendar("writer")).toBe(true)
    expect(canWriteGoogleCalendar("reader")).toBe(false)
  })
})

describe("Google Calendar event parsing", () => {
  it("normalizes a timed Google Meet event", () => {
    expect(
      parseGoogleCalendarEvent({
        id: "google-event-1",
        etag: "etag-1",
        summary: "Owner meeting",
        status: "confirmed",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
        start: {
          dateTime: "2026-08-20T09:00:00-06:00",
          timeZone: "America/Denver",
        },
        end: {
          dateTime: "2026-08-20T10:00:00-06:00",
          timeZone: "America/Denver",
        },
      }),
    ).toMatchObject({
      id: "google-event-1",
      summary: "Owner meeting",
      allDay: false,
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      timeZone: "America/Denver",
    })
  })

  it("uses exclusive end dates for all-day events", () => {
    expect(
      parseGoogleCalendarEvent({
        id: "holiday-1",
        start: { date: "2026-12-24" },
        end: { date: "2026-12-26" },
      }),
    ).toMatchObject({
      summary: "Busy",
      startDate: "2026-12-24",
      endDateExclusive: "2026-12-26",
      allDay: true,
    })
  })
})
