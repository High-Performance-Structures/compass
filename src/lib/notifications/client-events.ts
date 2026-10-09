/** Fired in the browser after something marks the viewer's notifications read. */
export const NOTIFICATIONS_CHANGED_EVENT = "compass:notifications-changed"

export function announceNotificationsChanged(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT))
}
