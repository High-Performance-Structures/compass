import type { ThemeDefinition } from "./types"
import { applyTheme, removeThemeOverride } from "./apply"

function prefersReducedMotion(): boolean {
  return window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches
}

function calcMaxRadius(x: number, y: number): number {
  return Math.hypot(
    Math.max(x, innerWidth - x),
    Math.max(y, innerHeight - y),
  )
}

function supportsViewTransitions(): boolean {
  return "startViewTransition" in document
}

export function applyThemeAnimated(
  theme: ThemeDefinition | null,
  origin?: { x: number; y: number },
): void {
  const mutate = () => {
    if (theme) {
      applyTheme(theme)
    } else {
      removeThemeOverride()
    }
  }

  if (
    !supportsViewTransitions() ||
    prefersReducedMotion()
  ) {
    mutate()
    return
  }

  const x = origin?.x ?? innerWidth / 2
  const y = origin?.y ?? innerHeight / 2
  const maxRadius = calcMaxRadius(x, y)

  const transition = document.startViewTransition(mutate)

  transition.ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${maxRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 400,
        easing: "ease-in-out",
        pseudoElement: "::view-transition-new(root)",
      },
    )
  })
}
