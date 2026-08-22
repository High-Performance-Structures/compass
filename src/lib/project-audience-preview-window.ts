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
