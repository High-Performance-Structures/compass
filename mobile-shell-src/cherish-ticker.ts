import type { FieldCherishRecognition } from "../src/lib/field/types"

export function renderCherishTicker(
  items: readonly FieldCherishRecognition[],
  escapeHtml: (value: string) => string,
): string {
  if (items.length === 0) return ""

  const recognitionItems = items.map((item) => {
    const submittedBy = item.isAnonymous
      ? "Anonymous"
      : item.submittedByName ?? "Team member"

    return `<span class="cherish-ticker-item"><strong>${escapeHtml(item.cherishValue)}</strong>${escapeHtml(item.message)}<small> — ${escapeHtml(submittedBy)}</small></span>`
  }).join("")

  return `<button id="today-cherish" class="cherish-spotlight" type="button" aria-label="Open CHERISH team recognition"><span class="cherish-ticker-label">CHERISH</span><span class="cherish-ticker-window"><span class="cherish-ticker-track">${recognitionItems}</span></span></button>`
}
