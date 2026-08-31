import { decodedLegacyProjectId } from "@/lib/legacy-project-route"

/** Decode only the encoded Buildertrend lead ID shape used by project routes. */
export function decodeProjectRouteId(value: string): string {
  return decodedLegacyProjectId(value) ?? value
}
