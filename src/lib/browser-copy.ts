"use client"

export type RichCopyResult = "rich" | "plain" | "failed"

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") {
    return false
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Browser permission settings can block async clipboard writes.
    }
  }

  return copyTextWithSelection(text)
}

export async function copyHtmlToClipboard({
  html,
  plain,
}: {
  readonly html: string
  readonly plain: string
}): Promise<RichCopyResult> {
  if (typeof window === "undefined") {
    return "failed"
  }

  if ("ClipboardItem" in window && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ])
      return "rich"
    } catch {
      // Fall back to plain text so the button still does useful work.
    }
  }

  if (copyHtmlWithSelection(html)) {
    return "rich"
  }

  return (await copyTextToClipboard(plain)) ? "plain" : "failed"
}

export function showManualCopyDialog({
  title,
  text,
}: {
  readonly title: string
  readonly text: string
}): void {
  if (typeof window === "undefined") {
    return
  }

  const existing = document.querySelector("[data-compass-copy-fallback]")
  existing?.remove()

  const overlay = document.createElement("div")
  overlay.setAttribute("data-compass-copy-fallback", "true")
  overlay.style.position = "fixed"
  overlay.style.inset = "0"
  overlay.style.zIndex = "9999"
  overlay.style.display = "flex"
  overlay.style.alignItems = "center"
  overlay.style.justifyContent = "center"
  overlay.style.background = "rgb(15 23 42 / 0.45)"
  overlay.style.padding = "24px"

  const panel = document.createElement("div")
  panel.style.width = "min(720px, 100%)"
  panel.style.maxHeight = "min(620px, 90vh)"
  panel.style.display = "flex"
  panel.style.flexDirection = "column"
  panel.style.gap = "12px"
  panel.style.border = "1px solid rgb(203 213 225)"
  panel.style.borderRadius = "8px"
  panel.style.background = "white"
  panel.style.color = "rgb(15 23 42)"
  panel.style.padding = "16px"
  panel.style.boxShadow = "0 24px 80px rgb(15 23 42 / 0.25)"

  const heading = document.createElement("h2")
  heading.textContent = title
  heading.style.margin = "0"
  heading.style.fontSize = "16px"
  heading.style.fontWeight = "700"

  const instructions = document.createElement("p")
  instructions.textContent =
    "Your browser blocked automatic copying. The text is selected below so you can press Cmd+C or Ctrl+C."
  instructions.style.margin = "0"
  instructions.style.fontSize = "13px"
  instructions.style.color = "rgb(71 85 105)"

  const textArea = document.createElement("textarea")
  textArea.value = text
  textArea.style.minHeight = "260px"
  textArea.style.resize = "vertical"
  textArea.style.border = "1px solid rgb(203 213 225)"
  textArea.style.borderRadius = "6px"
  textArea.style.padding = "10px"
  textArea.style.font = "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace"
  textArea.style.color = "rgb(15 23 42)"

  const actions = document.createElement("div")
  actions.style.display = "flex"
  actions.style.justifyContent = "flex-end"
  actions.style.gap = "8px"

  const closeButton = document.createElement("button")
  closeButton.type = "button"
  closeButton.textContent = "Close"
  closeButton.style.border = "1px solid rgb(203 213 225)"
  closeButton.style.borderRadius = "6px"
  closeButton.style.background = "white"
  closeButton.style.padding = "8px 12px"
  closeButton.style.cursor = "pointer"

  const close = (): void => {
    overlay.remove()
  }

  closeButton.addEventListener("click", close)
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close()
    }
  })
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        close()
      }
    },
    { once: true }
  )

  actions.appendChild(closeButton)
  panel.appendChild(heading)
  panel.appendChild(instructions)
  panel.appendChild(textArea)
  panel.appendChild(actions)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  textArea.focus()
  textArea.select()
}

function copyTextWithSelection(text: string): boolean {
  const activeElement = document.activeElement
  const textArea = document.createElement("textarea")
  textArea.value = text
  textArea.setAttribute("readonly", "true")
  textArea.style.position = "fixed"
  textArea.style.inset = "0"
  textArea.style.width = "1px"
  textArea.style.height = "1px"
  textArea.style.opacity = "0"
  textArea.style.pointerEvents = "none"

  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  textArea.setSelectionRange(0, text.length)

  let copied = false
  try {
    copied = document.execCommand("copy")
  } catch {
    copied = false
  }

  textArea.remove()
  if (activeElement instanceof HTMLElement) {
    activeElement.focus()
  }

  return copied
}

function copyHtmlWithSelection(html: string): boolean {
  const activeElement = document.activeElement
  const selection = document.getSelection()
  const savedRanges: Range[] = []

  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      savedRanges.push(selection.getRangeAt(index).cloneRange())
    }
  }

  const container = document.createElement("div")
  container.setAttribute("contenteditable", "true")
  container.style.position = "fixed"
  container.style.left = "-10000px"
  container.style.top = "0"
  container.style.width = "720px"
  container.style.background = "white"
  container.style.color = "black"
  container.innerHTML = html

  document.body.appendChild(container)

  const range = document.createRange()
  range.selectNodeContents(container)
  selection?.removeAllRanges()
  selection?.addRange(range)
  container.focus()

  let copied = false
  try {
    copied = document.execCommand("copy")
  } catch {
    copied = false
  }

  container.remove()
  selection?.removeAllRanges()
  for (const savedRange of savedRanges) {
    selection?.addRange(savedRange)
  }

  if (activeElement instanceof HTMLElement) {
    activeElement.focus()
  }

  return copied
}
