import type { ListeningRoomStatus } from "@/app/actions/listening-room"
import type { NotificationCenterScope } from "@/app/actions/notifications"
import type { NotificationCenterLoader } from "@/components/notifications/notification-center-store"
import type { PresenceStatus } from "@/app/actions/presence"
import { audienceScopeFromUrl, scopedAudienceHref } from "@/lib/project-audience-request"

/**
 * Checks that run on a timer on every page. They use plain requests rather
 * than server actions: a tab runs its server actions one at a time, so a
 * timed check that hit a slow moment held up whatever the person had just
 * opened.
 */

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok && response.status !== 400 && response.status !== 403) throw new Error(`Request failed (${response.status})`)
  return response.json()
}

/** Keeps an owner or vendor preview's scope on the request, as page links do. */
export function previewScoped(href: string): string {
  const scope = audienceScopeFromUrl(new URL(window.location.href))
  return scope ? scopedAudienceHref(href, scope) : href
}

export const fetchNotificationCenter: NotificationCenterLoader = async (scope?: NotificationCenterScope) => {
  const params = new URLSearchParams()
  if (scope) {
    params.set("projectId", scope.projectId)
    params.set("audience", scope.audience)
  }
  const query = params.size > 0 ? `?${params.toString()}` : ""
  return readJson(await fetch(previewScoped(`/api/notifications/center${query}`), { cache: "no-store" }))
}

export async function fetchListeningRoomStatus(channelId: string): Promise<Result<ListeningRoomStatus>> {
  return readJson(await fetch(`/api/listening-room/status?channelId=${encodeURIComponent(channelId)}`, { cache: "no-store" }))
}

export async function sendPresence(status?: PresenceStatus, statusMessage?: string, observedActivity = false): Promise<Result<null> | { readonly success: true }> {
  return readJson(await fetch("/api/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, statusMessage, observedActivity }),
  }))
}
