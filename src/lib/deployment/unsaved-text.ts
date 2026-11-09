/**
 * Safety net for text typed into a tab when Compass updates.
 *
 * If a save fails because Compass was updated, or someone refreshes while an
 * update notice is showing, the text they typed would be lost with the page.
 * So, at those moments, Compass copies what was typed (snapshotTypedText) into
 * this tab's sessionStorage. After the page reloads, restoreTypedText puts each
 * value back into the same field, as fields appear, and the notice
 * "Restored your unsaved text" offers a way to discard it.
 *
 * What is kept: text inputs (text, search, email, url, tel, number and date
 * kinds), textareas and rich-text editors (contenteditable, restored as plain
 * text), but only fields a person actually typed into on this page. Never
 * passwords, hidden or file inputs, checkboxes, card or one-time codes, or any
 * field marked `data-compass-no-restore`.
 *
 * Limits, honestly: fields are matched by page path plus the field's name,
 * aria-label, placeholder or id (and position among identical ones). A field
 * that only appears after clicking (a closed dialog, another tab of a form)
 * is restored only if it appears within RESTORE_WATCH_MS of the reload.
 * Rich text comes back without formatting. Dropdowns, date pickers built from
 * buttons, file choices and checkboxes are not kept. Storage is per tab:
 * closing the tab discards the copy. Copies expire after SNAPSHOT_MAX_AGE_MS.
 */

const UNSAVED_TEXT_STORAGE_KEY = "compass:unsaved-text"
export const SNAPSHOT_MAX_AGE_MS = 30 * 60_000
export const RESTORE_WATCH_MS = 20_000
const MAX_FIELDS = 100
const MAX_VALUE_LENGTH = 20_000
const MAX_TOTAL_LENGTH = 200_000

const TEXT_INPUT_TYPES = new Set([
  "",
  "text",
  "search",
  "email",
  "url",
  "tel",
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
])

type SavedField = {
  readonly key: string
  readonly value: string
}

export type TextSnapshot = {
  readonly path: string
  readonly savedAt: number
  readonly fields: readonly SavedField[]
}

type EditableElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement

const typedFields = new WeakSet<Element>()

function editableRoot(target: EventTarget | null): EditableElement | null {
  if (!(target instanceof HTMLElement)) return null
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target
  }
  // Typing inside a rich-text editor fires on the editor root (or a child).
  let node: HTMLElement | null = target
  let root: HTMLElement | null = null
  while (node !== null) {
    if (node.isContentEditable) root = node
    node = node.parentElement
  }
  return root
}

/** Remember which fields a person typed into (call once per page). */
export function trackTypedFields(doc: Document): () => void {
  function handleInput(event: Event): void {
    if (!event.isTrusted) return
    const field = editableRoot(event.target)
    if (field !== null) typedFields.add(field)
  }
  doc.addEventListener("input", handleInput, true)
  return () => doc.removeEventListener("input", handleInput, true)
}

/** Test hook: mark a field as typed into without a trusted event. */
export function markTyped(field: Element): void {
  typedFields.add(field)
}

function isRestorable(element: Element): element is EditableElement {
  if (element.closest("[data-compass-no-restore]") !== null) return false
  const autocomplete = element.getAttribute("autocomplete") ?? ""
  if (autocomplete === "one-time-code" || autocomplete.startsWith("cc-")) {
    return false
  }
  if (element instanceof HTMLInputElement) {
    return (
      TEXT_INPUT_TYPES.has(element.type) &&
      !element.disabled &&
      !element.readOnly
    )
  }
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly
  }
  return element instanceof HTMLElement && element.isContentEditable
}

function identity(element: EditableElement): string {
  const kind =
    element instanceof HTMLInputElement
      ? `input:${element.type}`
      : element instanceof HTMLTextAreaElement
        ? "textarea"
        : "rich"
  const label =
    element.getAttribute("name") ||
    element.getAttribute("aria-label") ||
    element.getAttribute("placeholder") ||
    element.getAttribute("data-placeholder") ||
    element.id ||
    "field"
  return `${kind}|${label}`
}

function candidateFields(doc: Document): EditableElement[] {
  const all = Array.from(
    doc.querySelectorAll("input, textarea, [contenteditable]")
  )
  // Keep only the outermost contenteditable of each editor.
  return all.filter(
    (element): element is EditableElement =>
      isRestorable(element) &&
      !(
        element instanceof HTMLElement &&
        !(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLTextAreaElement) &&
        element.parentElement?.isContentEditable === true
      )
  )
}

/** Each field's key: identity plus its position among identical fields. */
function keyedFields(doc: Document): Array<{ key: string; element: EditableElement }> {
  const seen = new Map<string, number>()
  return candidateFields(doc).map((element) => {
    const id = identity(element)
    const index = seen.get(id) ?? 0
    seen.set(id, index + 1)
    return { key: `${id}#${index}`, element }
  })
}

function readValue(element: EditableElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value
  }
  return element.innerText ?? element.textContent ?? ""
}

/**
 * Set a field's value so React (and editors like TipTap) notice. React tracks
 * the last value it saw, so the value goes through the element's own setter
 * and then an input event, exactly as typing would.
 */
function writeValue(element: EditableElement, value: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
    if (setter) setter.call(element, value)
    else element.value = value
    element.dispatchEvent(new Event("input", { bubbles: true }))
    element.dispatchEvent(new Event("change", { bubbles: true }))
    return
  }
  element.focus()
  const selection = element.ownerDocument.getSelection()
  if (selection !== null) {
    const range = element.ownerDocument.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  // insertText goes through the editor's own input handling (TipTap and
  // ProseMirror listen for it). Fall back to plain text where unsupported.
  let inserted = false
  try {
    inserted = element.ownerDocument.execCommand("insertText", false, value)
  } catch {
    inserted = false
  }
  if (!inserted) {
    element.textContent = value
    element.dispatchEvent(new Event("input", { bubbles: true }))
  }
}

/** Copy what was typed on this page. Returns null when nothing was typed. */
export function snapshotTypedText(
  doc: Document,
  path: string,
  now: number
): TextSnapshot | null {
  const fields: SavedField[] = []
  let total = 0
  for (const { key, element } of keyedFields(doc)) {
    if (!typedFields.has(element)) continue
    const value = readValue(element)
    if (value.trim().length === 0 || value.length > MAX_VALUE_LENGTH) continue
    if (total + value.length > MAX_TOTAL_LENGTH) break
    total += value.length
    fields.push({ key, value })
    if (fields.length >= MAX_FIELDS) break
  }
  return fields.length === 0 ? null : { path, savedAt: now, fields }
}

export function saveSnapshot(storage: Storage | null, snapshot: TextSnapshot): void {
  try {
    storage?.setItem(UNSAVED_TEXT_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Full or blocked storage: the safety net is best effort.
  }
}

export function clearSnapshot(storage: Storage | null): void {
  try {
    storage?.removeItem(UNSAVED_TEXT_STORAGE_KEY)
  } catch {
    // Ignore blocked storage.
  }
}

function parseSnapshot(value: unknown): TextSnapshot | null {
  if (typeof value !== "object" || value === null) return null
  const path = Reflect.get(value, "path")
  const savedAt = Reflect.get(value, "savedAt")
  const fields = Reflect.get(value, "fields")
  if (typeof path !== "string" || typeof savedAt !== "number") return null
  if (!Array.isArray(fields)) return null
  const parsed: SavedField[] = []
  for (const field of fields) {
    if (typeof field !== "object" || field === null) continue
    const key = Reflect.get(field, "key")
    const fieldValue = Reflect.get(field, "value")
    if (typeof key === "string" && typeof fieldValue === "string") {
      parsed.push({ key, value: fieldValue })
    }
  }
  return { path, savedAt, fields: parsed }
}

/** The saved copy for `path`, if one exists and has not expired. */
export function loadSnapshot(
  storage: Storage | null,
  path: string,
  now: number
): TextSnapshot | null {
  try {
    const raw = storage?.getItem(UNSAVED_TEXT_STORAGE_KEY)
    if (!raw) return null
    const snapshot = parseSnapshot(JSON.parse(raw))
    if (snapshot === null || now - snapshot.savedAt > SNAPSHOT_MAX_AGE_MS) {
      clearSnapshot(storage)
      return null
    }
    return snapshot.path === path ? snapshot : null
  } catch {
    return null
  }
}

export type RestoredField = {
  readonly key: string
  readonly element: EditableElement
  readonly previousValue: string
}

/**
 * Put saved values back into fields on the page now. `pending` lists the keys
 * still waiting for their field; restored keys are removed from it. A field
 * that already holds the saved value (because it was saved after all) is left
 * alone and not reported.
 */
export function restoreTypedText(
  doc: Document,
  pending: Map<string, string>
): RestoredField[] {
  const restored: RestoredField[] = []
  if (pending.size === 0) return restored
  for (const { key, element } of keyedFields(doc)) {
    const value = pending.get(key)
    if (value === undefined) continue
    pending.delete(key)
    const previousValue = readValue(element)
    if (previousValue === value) continue
    writeValue(element, value)
    restored.push({ key, element, previousValue })
  }
  return restored
}

/** Undo a restore: put back what each field held before. */
export function discardRestoredText(fields: readonly RestoredField[]): void {
  for (const field of fields) {
    if (field.element.isConnected) writeValue(field.element, field.previousValue)
  }
}
