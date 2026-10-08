// Field Mode renders message text as HTML strings, so formatting must start
// from escaped text and only add tags it creates itself.

const LONG_MESSAGE_CHARACTERS = 320
const LONG_MESSAGE_LINES = 6

export function escapeFieldHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }
    return entities[character] ?? character
  })
}

/** Escapes message text and turns **bold** markers into <strong>. */
export function fieldMessageHtml(content: string): string {
  return escapeFieldHtml(content).replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
}

/** True when a message should start collapsed behind "Show more". */
export function isLongFieldMessage(content: string): boolean {
  return content.length > LONG_MESSAGE_CHARACTERS || content.split("\n").length > LONG_MESSAGE_LINES
}
