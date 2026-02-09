// module-level bridge state store
// works outside React context (like model-dropdown's shared state)
// both ChatProvider and settings tab read/write from here

interface BridgeState {
  readonly connected: boolean
  readonly enabled: boolean
}

let state: BridgeState = {
  connected: false,
  enabled: false,
}

const listeners = new Set<() => void>()

export function getBridgeSnapshot(): BridgeState {
  return state
}

export function subscribeBridge(
  listener: () => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(): void {
  for (const l of listeners) l()
}

export function setBridgeConnected(
  connected: boolean
): void {
  if (state.connected === connected) return
  state = { ...state, connected }
  notify()
}

export function setBridgeEnabled(
  enabled: boolean
): void {
  if (state.enabled === enabled) return
  state = { ...state, enabled }
  if (typeof window !== "undefined") {
    localStorage.setItem(
      "compass-bridge-enabled",
      String(enabled)
    )
  }
  notify()
}

// initialize from localStorage on module load
if (typeof window !== "undefined") {
  const stored = localStorage.getItem(
    "compass-bridge-enabled"
  )
  if (stored === "true") {
    state = { ...state, enabled: true }
  }
}
