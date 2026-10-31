"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { userProviderConfig } from "@/db/schema-ai-config"
import { getCurrentUser } from "@/lib/auth"

// Check if user already has OAuth configured
export async function hasOAuthConfigured(): Promise<boolean> {
  try {
    const user = await getCurrentUser()
    if (!user) return false

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

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
