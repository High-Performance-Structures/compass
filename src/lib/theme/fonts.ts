const loadedFonts = new Set<string>()

export function loadGoogleFonts(
  fonts: ReadonlyArray<string>,
): void {
  const toLoad = fonts.filter((f) => !loadedFonts.has(f))
  if (toLoad.length === 0) return

  for (const font of toLoad) {
    loadedFonts.add(font)
  }

  const families = toLoad
    .map((f) => `family=${f.replace(/ /g, "+")}:wght@300;400;500;600;700`)
    .join("&")

  const href =
    `https://fonts.googleapis.com/css2?${families}&display=swap`

  const existing = document.querySelector(
    `link[href="${href}"]`,
  )
  if (existing) return

  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = href
  document.head.appendChild(link)
}
