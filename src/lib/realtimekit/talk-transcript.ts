export type TranscriptEntry = {
  readonly id: string
  readonly name: string
  readonly transcript: string
  readonly isPartialTranscript: boolean
  readonly date: Date
}

export type TranscriptState = {
  readonly entries: readonly TranscriptEntry[]
  /** Entry key → index in `entries`, so caption updates avoid scanning the list. */
  readonly indexByKey: ReadonlyMap<string, number>
}

export const EMPTY_TRANSCRIPT: TranscriptState = {
  entries: [],
  indexByKey: new Map(),
}

export function transcriptKey(entry: TranscriptEntry): string {
  return entry.id.length > 0
    ? entry.id
    : `${entry.name}-${entry.date.getTime()}-${entry.transcript}`
}

function indexEntries(entries: readonly TranscriptEntry[]): TranscriptState {
  return {
    entries,
    indexByKey: new Map(entries.map((entry, index) => [transcriptKey(entry), index])),
  }
}

export function transcriptFromEntries(
  entries: readonly TranscriptEntry[]
): TranscriptState {
  return indexEntries(
    [...entries].sort((a, b) => a.date.getTime() - b.date.getTime())
  )
}

/**
 * Partial captions repeat the same key several times per second. Replace them
 * in place, append new lines (they normally arrive in time order), and only
 * re-sort when an out-of-order line arrives.
 */
export function addTranscriptEntry(
  state: TranscriptState,
  entry: TranscriptEntry
): TranscriptState {
  const key = transcriptKey(entry)
  const existing = state.indexByKey.get(key)
  if (existing !== undefined) {
    const current = state.entries[existing]
    if (current && current.date.getTime() === entry.date.getTime()) {
      const entries = [...state.entries]
      entries[existing] = entry
      return { entries, indexByKey: state.indexByKey }
    }
    return transcriptFromEntries([
      ...state.entries.filter((_, index) => index !== existing),
      entry,
    ])
  }

  const last = state.entries.at(-1)
  if (!last || last.date.getTime() <= entry.date.getTime()) {
    const indexByKey = new Map(state.indexByKey)
    indexByKey.set(key, state.entries.length)
    return { entries: [...state.entries, entry], indexByKey }
  }
  return transcriptFromEntries([...state.entries, entry])
}

export function finalTranscriptText(entries: readonly TranscriptEntry[]): string {
  return entries
    .filter((entry) => !entry.isPartialTranscript)
    .map((entry) => {
      const time = entry.date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
      return `[${time}] ${entry.name}: ${entry.transcript}`
    })
    .join("\n")
}
