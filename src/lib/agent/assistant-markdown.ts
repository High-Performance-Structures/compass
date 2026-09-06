/**
 * Keeps streamed assistant Markdown compact when providers emit whitespace-only
 * paragraphs or encoded spaces between otherwise normal blocks.
 */
export function normalizeAssistantMarkdown(value: string): string {
  const compactLines: string[] = []
  let fence: Readonly<{ character: "`" | "~"; length: number }> | null = null

  for (const rawLine of value.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      const closingMatch = /^\s*(`+|~+)\s*$/.exec(rawLine)
      const closingMarker = closingMatch?.[1]
      if (
        closingMarker &&
        closingMarker[0] === fence.character &&
        closingMarker.length >= fence.length
      ) {
        fence = null
      }
      compactLines.push(rawLine.trimEnd())
      continue
    }

    const openingMatch = /^\s*(`{3,}|~{3,})/.exec(rawLine)
    const openingMarker = openingMatch?.[1]
    if (openingMarker) {
      const character = openingMarker[0]
      if (character === "`" || character === "~") {
        fence = { character, length: openingMarker.length }
      }
      compactLines.push(rawLine.trimEnd())
      continue
    }

    const line = /^(?:\s|&#x20;|&nbsp;)*$/i.test(rawLine)
      ? ""
      : rawLine.trimEnd()
    if (line === "" && compactLines.at(-1) === "") continue
    compactLines.push(line)
  }

  while (compactLines[0] === "") compactLines.shift()
  while (compactLines.at(-1) === "") compactLines.pop()
  return compactLines.join("\n")
}
