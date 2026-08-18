export type NativeFieldPlatform = "ios" | "android" | "web"

export function fieldModeUrl(platform: NativeFieldPlatform): string {
  if (platform === "ios" || platform === "android") {
    return "compass://field"
  }
  return "/dashboard/field"
}
