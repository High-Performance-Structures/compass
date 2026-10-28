export type PickedProjectFile = {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly kind: "file" | "folder"
}

/**
 * Adds picked files to a list of link rows: fills blank rows first, skips
 * files already listed, then appends the rest.
 */
export function withPickedFiles<T extends { readonly id: string; readonly label: string; readonly url: string; readonly notes: string }>(
  links: readonly T[],
  picked: readonly PickedProjectFile[],
  makeRow: () => T,
): T[] {
  const existing = new Set(links.map((link) => link.url.trim()).filter(Boolean))
  const queue = picked.filter((file) => !existing.has(file.url))
  const next = links.map((link) => {
    if (link.url.trim() || link.label.trim()) return link
    const file = queue.shift()
    return file ? { ...link, label: file.name, url: file.url } : link
  })
  for (const file of queue) next.push({ ...makeRow(), label: file.name, url: file.url })
  return next
}
