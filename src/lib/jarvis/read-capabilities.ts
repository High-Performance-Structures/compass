import type { AuthUser } from "@/lib/auth"
import { canFeature } from "@/lib/permission-enforcement"

export const JARVIS_READ_CAPABILITIES = [
  "project-hub",
  "daily-logs",
  "rfis",
  "owner-updates",
  "budget",
  "work-calendar",
] as const

export type JarvisReadCapability =
  (typeof JARVIS_READ_CAPABILITIES)[number]

export function jarvisReadCapabilitiesForUser(
  user: AuthUser,
): Promise<readonly JarvisReadCapability[]> {
  return Promise.all(
    JARVIS_READ_CAPABILITIES.map(async (featureId) => ({
      featureId,
      allowed: await canFeature(user, featureId, "read"),
    })),
  ).then((results) =>
    results
      .filter((result) => result.allowed)
      .map((result) => result.featureId),
  )
}

export function parseJarvisReadCapabilities(
  value: unknown,
): ReadonlySet<JarvisReadCapability> {
  if (!Array.isArray(value)) return new Set()

  const allowed = new Set<string>(JARVIS_READ_CAPABILITIES)
  return new Set(
    value.filter(
      (capability): capability is JarvisReadCapability =>
        typeof capability === "string" && allowed.has(capability),
    ),
  )
}
