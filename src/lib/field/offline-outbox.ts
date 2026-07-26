import type {
  CherishPulseResponseType,
  CherishValue,
} from "@/app/actions/cherish-pulse"

export type FieldOutboxJarvisPrompt = {
  readonly id: string
  readonly kind: "jarvis_prompt"
  readonly text: string
  readonly createdAt: string
}

export type FieldOutboxCherishPulse = {
  readonly id: string
  readonly kind: "cherish_pulse"
  readonly cherishValue: CherishValue
  readonly responseType: CherishPulseResponseType
  readonly message: string
  readonly createdAt: string
}

export type FieldOutboxItem =
  | FieldOutboxJarvisPrompt
  | FieldOutboxCherishPulse

export type FieldOutboxStorage = {
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
  readonly removeItem: (key: string) => void
}

type StoredOutbox = {
  readonly version: 1
  readonly items: readonly FieldOutboxItem[]
}

const STORAGE_PREFIX = "compass_field_outbox_v1"
const MAX_ITEMS = 50
const MAX_ITEM_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const FIELD_OUTBOX_CHANGED_EVENT = "compass-field-outbox-changed"

const CHERISH_VALUES: readonly CherishValue[] = [
  "Camaraderie",
  "Honor",
  "Excellence",
  "Reliability",
  "Integrity",
  "Servitude",
  "Humility",
]

function defaultStorage(): FieldOutboxStorage | null {
  if (typeof window === "undefined") return null
  return window.localStorage
}

function storageKey(scopeKey: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(scopeKey)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isCherishValue(value: unknown): value is CherishValue {
  return (
    typeof value === "string" &&
    CHERISH_VALUES.some((candidate) => candidate === value)
  )
}

function isResponseType(
  value: unknown,
): value is CherishPulseResponseType {
  return value === "shoutout" || value === "concern" || value === "win"
}

function parseItem(value: unknown): FieldOutboxItem | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return null
  }

  if (
    value.kind === "jarvis_prompt" &&
    typeof value.text === "string" &&
    value.text.trim().length > 0 &&
    value.text.length <= 20_000
  ) {
    return {
      id: value.id,
      kind: "jarvis_prompt",
      text: value.text,
      createdAt: value.createdAt,
    }
  }

  if (
    value.kind === "cherish_pulse" &&
    isCherishValue(value.cherishValue) &&
    isResponseType(value.responseType) &&
    typeof value.message === "string" &&
    value.message.trim().length >= 3 &&
    value.message.length <= 1_200
  ) {
    return {
      id: value.id,
      kind: "cherish_pulse",
      cherishValue: value.cherishValue,
      responseType: value.responseType,
      message: value.message,
      createdAt: value.createdAt,
    }
  }

  return null
}

function parseStoredOutbox(raw: string | null): StoredOutbox {
  if (!raw) return { version: 1, items: [] }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.items)
    ) {
      return { version: 1, items: [] }
    }

    const now = Date.now()
    const items = parsed.items
      .map(parseItem)
      .filter((item): item is FieldOutboxItem => item !== null)
      .filter((item) => {
        const createdAt = new Date(item.createdAt).getTime()
        return (
          Number.isFinite(createdAt) &&
          now - createdAt <= MAX_ITEM_AGE_MS
        )
      })
      .slice(-MAX_ITEMS)

    return { version: 1, items }
  } catch {
    return { version: 1, items: [] }
  }
}

function notifyOutboxChanged(scopeKey: string): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent(FIELD_OUTBOX_CHANGED_EVENT, {
      detail: { scopeKey },
    }),
  )
}

function writeItems(
  scopeKey: string,
  items: readonly FieldOutboxItem[],
  storage: FieldOutboxStorage,
): void {
  if (items.length === 0) {
    storage.removeItem(storageKey(scopeKey))
  } else {
    storage.setItem(
      storageKey(scopeKey),
      JSON.stringify({
        version: 1,
        items: items.slice(-MAX_ITEMS),
      }),
    )
  }
  notifyOutboxChanged(scopeKey)
}

export function listFieldOutboxItems(
  scopeKey: string,
  storage: FieldOutboxStorage | null = defaultStorage(),
): readonly FieldOutboxItem[] {
  if (!storage || !scopeKey) return []
  return parseStoredOutbox(storage.getItem(storageKey(scopeKey))).items
}

export function enqueueFieldOutboxItem(
  scopeKey: string,
  item: FieldOutboxItem,
  storage: FieldOutboxStorage | null = defaultStorage(),
): boolean {
  if (!storage || !scopeKey || parseItem(item) === null) return false
  const items = listFieldOutboxItems(scopeKey, storage)
  writeItems(scopeKey, [...items, item], storage)
  return true
}

export function removeFieldOutboxItem(
  scopeKey: string,
  itemId: string,
  storage: FieldOutboxStorage | null = defaultStorage(),
): void {
  if (!storage || !scopeKey) return
  const items = listFieldOutboxItems(scopeKey, storage)
  writeItems(
    scopeKey,
    items.filter((item) => item.id !== itemId),
    storage,
  )
}

export function createJarvisPromptOutboxItem(
  text: string,
): FieldOutboxJarvisPrompt {
  return {
    id: crypto.randomUUID(),
    kind: "jarvis_prompt",
    text: text.trim(),
    createdAt: new Date().toISOString(),
  }
}

export function createCherishPulseOutboxItem(input: {
  readonly cherishValue: CherishValue
  readonly responseType: CherishPulseResponseType
  readonly message: string
}): FieldOutboxCherishPulse {
  return {
    id: crypto.randomUUID(),
    kind: "cherish_pulse",
    cherishValue: input.cherishValue,
    responseType: input.responseType,
    message: input.message.trim(),
    createdAt: new Date().toISOString(),
  }
}
