import type { MessageKind } from "@/lib/notifications/message-stacks"
import type { PortfolioHealth, PortfolioPhaseId } from "@/lib/portfolio-map/model"

/** Phase colors come from the theme so the map follows the active palette. */
export const PHASE_COLOR_TOKEN: Readonly<Record<PortfolioPhaseId, string>> = {
  intake: "--primary",
  estimating: "--muted-foreground",
  design: "--info",
  permitting: "--chart-3",
  negotiation: "--chart-4",
  construction: "--success",
  closeout: "--chart-5",
}

export function phaseColor(phase: PortfolioPhaseId): string {
  return `var(${PHASE_COLOR_TOKEN[phase]})`
}

export const HEALTH_LABEL: Readonly<Record<PortfolioHealth, string>> = {
  ok: "On track",
  risk: "At risk",
  late: "Past due",
}

export function healthColor(health: PortfolioHealth): string {
  if (health === "late") return "var(--destructive)"
  if (health === "risk") return "var(--warning)"
  return "var(--success)"
}

/**
 * Resolve a theme token to a hex number for WebGL. The browser normalizes any
 * CSS color (hex, rgb, oklch) when painting a 1×1 canvas.
 */
export function themeColorHex(token: string, lighten = 0): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const context = document.createElement("canvas").getContext("2d")
  if (!value || !context) return 0x9aa3ae
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data
  const lift = (channel: number): number => Math.round(channel + (255 - channel) * lighten)
  return (lift(r) << 16) | (lift(g) << 8) | lift(b)
}

/** Messages layer tile colors (theme tokens), by kind of unread item. */
export const MESSAGE_KIND_COLOR_TOKEN: Readonly<Record<MessageKind, string>> = {
  message: "--brand-hps-green",
  mail: "--brand-compass-violet",
  rfi: "--brand-nutech-gold",
  schedule: "--brand-compass-blue",
  other: "--muted-foreground",
}
