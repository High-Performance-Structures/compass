type NavigationIntent = {
  readonly currentHref: string
  readonly targetHref: string
  readonly button: number
  readonly defaultPrevented: boolean
  readonly hasModifier: boolean
  readonly target: string
  readonly download: boolean
}

export function shouldTrackNavigation(intent: NavigationIntent): boolean {
  if (
    intent.button !== 0 ||
    intent.defaultPrevented ||
    intent.hasModifier ||
    intent.download ||
    (intent.target !== "" && intent.target !== "_self")
  ) {
    return false
  }

  const current = new URL(intent.currentHref)
  const target = new URL(intent.targetHref, current)
  if (target.origin !== current.origin) return false
  if (!["http:", "https:"].includes(target.protocol)) return false

  const sameDocument =
    target.pathname === current.pathname &&
    target.search === current.search
  if (sameDocument) return false

  return true
}
