import { describe, expect, it } from "vitest"

import {
  addedFieldProjectIds,
  FIELD_PROJECT_LIST_REFRESH_INTERVAL_MS,
  fieldProjectListRefreshUrl,
  mergeFieldProjectList,
  shouldRefreshFieldProjectList,
  type FieldProjectListRefreshState,
} from "./field-project-list"

const ready: FieldProjectListRefreshState = {
  online: true,
  signedIn: true,
  sessionExpired: false,
  signingIn: false,
  signingOut: false,
  biometricLocked: false,
  refreshing: false,
  lastRefreshAt: 0,
  now: 1_000_000,
  force: false,
}

describe("shouldRefreshFieldProjectList", () => {
  it("refreshes on open when signed in and online", () => {
    expect(shouldRefreshFieldProjectList(ready)).toBe(true)
  })

  it.each([
    ["offline", { online: false }],
    ["never signed in", { signedIn: false }],
    ["session expired", { sessionExpired: true }],
    ["mid sign-in", { signingIn: true }],
    ["signing out", { signingOut: true }],
    ["behind the biometric lock", { biometricLocked: true }],
    ["already refreshing", { refreshing: true }],
  ])("skips the refresh when %s, even when forced", (_label, change) => {
    expect(shouldRefreshFieldProjectList({ ...ready, ...change })).toBe(false)
    expect(
      shouldRefreshFieldProjectList({ ...ready, ...change, force: true })
    ).toBe(false)
  })

  it("throttles automatic refreshes to one a minute", () => {
    const lastRefreshAt = ready.now - FIELD_PROJECT_LIST_REFRESH_INTERVAL_MS + 1
    expect(shouldRefreshFieldProjectList({ ...ready, lastRefreshAt })).toBe(false)
    expect(
      shouldRefreshFieldProjectList({
        ...ready,
        lastRefreshAt: ready.now - FIELD_PROJECT_LIST_REFRESH_INTERVAL_MS,
      })
    ).toBe(true)
  })

  it("lets the Refresh button skip the throttle", () => {
    expect(
      shouldRefreshFieldProjectList({ ...ready, lastRefreshAt: ready.now, force: true })
    ).toBe(true)
  })
})

describe("fieldProjectListRefreshUrl", () => {
  it("asks for the list only and cache-busts the request", () => {
    expect(fieldProjectListRefreshUrl("https://compass.example", 1724160000123)).toBe(
      "https://compass.example/api/field/native-bootstrap?listOnly=1&refresh=1724160000123"
    )
  })
})

describe("mergeFieldProjectList", () => {
  const listed = [{ id: "p-2" }, { id: "p-3" }]

  it("leaves the open project alone while it is still listed", () => {
    expect(mergeFieldProjectList("p-3", listed)).toEqual({ kind: "unchanged" })
  })

  it("leaves nothing to merge when no project is open", () => {
    expect(mergeFieldProjectList(null, listed)).toEqual({ kind: "unchanged" })
  })

  it("moves the saved active project to the first listed job when the open one leaves", () => {
    expect(mergeFieldProjectList("p-1", listed)).toEqual({
      kind: "active_removed",
      removedProjectId: "p-1",
      nextActiveProjectId: "p-2",
    })
  })

  it("falls back to the picker when no jobs are left", () => {
    expect(mergeFieldProjectList("p-1", [])).toEqual({
      kind: "active_removed",
      removedProjectId: "p-1",
      nextActiveProjectId: null,
    })
  })
})

describe("addedFieldProjectIds", () => {
  it("lists only the jobs that are new, in list order", () => {
    expect(
      addedFieldProjectIds(
        [{ id: "p-1" }, { id: "p-2" }],
        [{ id: "p-4" }, { id: "p-2" }, { id: "p-3" }]
      )
    ).toEqual(["p-4", "p-3"])
  })
})
