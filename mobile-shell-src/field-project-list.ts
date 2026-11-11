// Keeps the native Field Mode project list current without signing out.
//
// The bundled shell used to download the project list only at sign-in, so a
// job added (or removed) on the server stayed invisible until the person signed
// out and back in. These helpers decide when the shell quietly re-fetches the
// list and how the new list merges with what is already on the phone. They are
// pure so the rules can be tested without Capacitor.

/** Automatic refreshes (app open / resume) run at most this often. */
export const FIELD_PROJECT_LIST_REFRESH_INTERVAL_MS = 60_000

export type FieldProjectListRefreshState = {
  readonly online: boolean
  /** A saved Compass profile means this device has signed in before. */
  readonly signedIn: boolean
  readonly sessionExpired: boolean
  readonly signingIn: boolean
  readonly signingOut: boolean
  readonly biometricLocked: boolean
  readonly refreshing: boolean
  /** When the last refresh started, or 0 when none has run yet. */
  readonly lastRefreshAt: number
  readonly now: number
  /** A tap on Refresh skips the throttle; nothing else does. */
  readonly force: boolean
}

export function shouldRefreshFieldProjectList(
  state: FieldProjectListRefreshState
): boolean {
  if (
    !state.online ||
    !state.signedIn ||
    state.sessionExpired ||
    state.signingIn ||
    state.signingOut ||
    // The refresh never runs behind the lock screen; unlocking triggers it.
    state.biometricLocked ||
    state.refreshing
  ) {
    return false
  }
  if (state.force) return true
  return state.now - state.lastRefreshAt >= FIELD_PROJECT_LIST_REFRESH_INTERVAL_MS
}

/**
 * `listOnly=1` asks the server for the profile, projects and companies without
 * building a project packet. The unique `refresh` value defeats the iOS native
 * URL cache, matching the packet refresh URL.
 */
export function fieldProjectListRefreshUrl(
  liveUrl: string,
  requestId: number
): string {
  const url = new URL("/api/field/native-bootstrap", liveUrl)
  url.searchParams.set("listOnly", "1")
  url.searchParams.set("refresh", String(requestId))
  return url.toString()
}

export type FieldProjectListMerge =
  /** No project is open, or the open project is still on the list. */
  | { readonly kind: "unchanged" }
  /**
   * The open project left the list. The open packet, its cached copy and any
   * waiting work stay put so nothing in progress is lost; the saved active
   * project moves to `nextActiveProjectId` so the next launch opens a listed
   * job (or the project picker when the list is empty).
   */
  | {
      readonly kind: "active_removed"
      readonly removedProjectId: string
      readonly nextActiveProjectId: string | null
    }

export function mergeFieldProjectList(
  activeProjectId: string | null,
  refreshedProjects: readonly { readonly id: string }[]
): FieldProjectListMerge {
  if (
    activeProjectId === null ||
    refreshedProjects.some((project) => project.id === activeProjectId)
  ) {
    return { kind: "unchanged" }
  }
  return {
    kind: "active_removed",
    removedProjectId: activeProjectId,
    nextActiveProjectId: refreshedProjects[0]?.id ?? null,
  }
}

/** Project ids that are new on the refreshed list, in list order. */
export function addedFieldProjectIds(
  previousProjects: readonly { readonly id: string }[],
  refreshedProjects: readonly { readonly id: string }[]
): readonly string[] {
  const previous = new Set(previousProjects.map((project) => project.id))
  return refreshedProjects
    .map((project) => project.id)
    .filter((id) => !previous.has(id))
}
