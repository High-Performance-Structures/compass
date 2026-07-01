"use server"

import { getCurrentUser } from "@/lib/auth"
import { isDemoOrg, isDemoUser } from "@/lib/demo"

export type SettingsContext = {
  readonly demoMode: boolean
}

export async function getSettingsContext(): Promise<SettingsContext> {
  const user = await getCurrentUser()

  if (!user) {
    return { demoMode: false }
  }

  return {
    demoMode:
      isDemoUser(user.id) ||
      (user.organizationId !== null && isDemoOrg(user.organizationId)),
  }
}
