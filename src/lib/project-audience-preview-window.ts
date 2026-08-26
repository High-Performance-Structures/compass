export const PROJECT_AUDIENCE_PREVIEW_WINDOW_NAME =
  "compass-project-audience-preview"

const PROJECT_AUDIENCE_PREVIEW_WINDOW_FEATURES = [
  "popup=yes",
  "width=1180",
  "height=800",
  "resizable=yes",
  "scrollbars=yes",
].join(",")

type PreviewWindow = {
  focus: () => void
}

type PreviewWindowController = {
  readonly closed: boolean
  close: () => void
  readonly location: {
    replace: (href: string) => void
  }
}

type PreviewCloseScheduler = (
  callback: () => void,
  delayMilliseconds: number
) => void

type PreviewWindowOpener = (
  href: string,
  target: string,
  features: string
) => PreviewWindow | null

export function openProjectAudiencePreviewWindow(
  href: string,
  opener?: PreviewWindowOpener
): boolean {
  if (!opener && typeof window === "undefined") return false

  const previewWindow = opener
    ? opener(
        href,
        PROJECT_AUDIENCE_PREVIEW_WINDOW_NAME,
        PROJECT_AUDIENCE_PREVIEW_WINDOW_FEATURES
      )
    : window.open(
        href,
        PROJECT_AUDIENCE_PREVIEW_WINDOW_NAME,
        PROJECT_AUDIENCE_PREVIEW_WINDOW_FEATURES
      )

  if (!previewWindow) return false
  previewWindow.focus()
  return true
}

export function closeProjectAudiencePreviewWindow(
  fallbackHref: string,
  targetWindow?: PreviewWindowController,
  scheduleFallback?: PreviewCloseScheduler
): void {
  const previewWindow =
    targetWindow ?? (typeof window === "undefined" ? null : window)
  if (!previewWindow) return

  previewWindow.close()

  const schedule =
    scheduleFallback ??
    ((callback: () => void, delayMilliseconds: number): void => {
      window.setTimeout(callback, delayMilliseconds)
    })

  // Direct sidebar navigation can place preview mode in a normal browser tab,
  // which browsers refuse to close. Replace that tab with the internal project.
  schedule(() => {
    if (!previewWindow.closed) previewWindow.location.replace(fallbackHref)
  }, 100)
}
