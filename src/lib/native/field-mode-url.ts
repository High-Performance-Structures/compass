export type NativeFieldPlatform = "ios" | "android" | "web"

export function fieldModeUrl(platform: NativeFieldPlatform): string {
  if (platform === "ios") return "capacitor://localhost"
  if (platform === "android") return "https://localhost"
  return "/dashboard/field"
}
