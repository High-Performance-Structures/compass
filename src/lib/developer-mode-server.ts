import "server-only"

import { cookies } from "next/headers"

import {
  DEVELOPER_MODE_COOKIE,
  developerModeFromCookie,
} from "@/lib/developer-mode"

export async function isDeveloperModeEnabled(
  canUseDeveloperMode: boolean,
): Promise<boolean> {
  if (!canUseDeveloperMode) return false
  const cookieStore = await cookies()
  return developerModeFromCookie(
    cookieStore.get(DEVELOPER_MODE_COOKIE)?.value,
    canUseDeveloperMode,
  )
}
