type PrintNavigator = Readonly<{
  userAgent: string
  platform: string
  maxTouchPoints: number
}>

/**
 * iPadOS may identify itself as macOS. Safari requires window.print() to run
 * while the original tap still owns user activation, so avoid async waits on
 * both traditional iOS identifiers and touch-capable MacIntel devices.
 */
export function requiresSynchronousPrint(
  browserNavigator: PrintNavigator
): boolean {
  if (/iPad|iPhone|iPod/i.test(browserNavigator.userAgent)) return true

  return (
    browserNavigator.platform === "MacIntel" &&
    browserNavigator.maxTouchPoints > 1
  )
}
