"use server"

import { eq } from "drizzle-orm"
import { userProviderConfig } from "@/db/schema-ai-config"
import { userContext } from "@/lib/server/action-context"

// Check if user already has OAuth configured
export async function hasOAuthConfigured(): Promise<boolean> {
  try {
    const context = await userContext()
    if (!context.success) return false
    const { user, db } = context.data

    const config = await db
      .select()
      .from(userProviderConfig)
      .where(eq(userProviderConfig.userId, user.id))
      .get()

    // Has config and it's not empty/inactive
    return (
      config !== undefined &&
      config.isActive === 1 &&
      config.providerType !== ""
    )
  } catch {
    return false
  }
}
