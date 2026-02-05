import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { users } from "@/db/schema"
import type { User } from "@/db/schema"
import { eq } from "drizzle-orm"
import { SESSION_COOKIE, decodeJwtPayload } from "@/lib/session"

export type AuthUser = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  displayName: string | null
  avatarUrl: string | null
  role: string
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const isWorkOSConfigured =
      process.env.WORKOS_API_KEY &&
      process.env.WORKOS_CLIENT_ID &&
      !process.env.WORKOS_API_KEY.includes("placeholder")

    if (!isWorkOSConfigured) {
      return {
        id: "dev-user-1",
        email: "dev@compass.io",
        firstName: "Dev",
        lastName: "User",
        displayName: "Dev User",
        avatarUrl: null,
        role: "admin",
        isActive: true,
        lastLoginAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }

    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE)?.value
    if (!token) return null

    const payload = decodeJwtPayload(token)
    if (!payload?.sub) return null

    const userId = payload.sub as string
    const { env } = await getCloudflareContext()
    if (!env?.DB) return null

    const db = getDb(env.DB)
    const dbUser = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get()

    if (!dbUser) return null

    const now = new Date().toISOString()
    await db
      .update(users)
      .set({ lastLoginAt: now })
      .where(eq(users.id, userId))
      .run()

    return {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      displayName: dbUser.displayName,
      avatarUrl: dbUser.avatarUrl,
      role: dbUser.role,
      isActive: dbUser.isActive,
      lastLoginAt: now,
      createdAt: dbUser.createdAt,
      updatedAt: dbUser.updatedAt,
    }
  } catch (error) {
    console.error("Error getting current user:", error)
    return null
  }
}

export async function ensureUserExists(workosUser: {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  profilePictureUrl?: string | null
}): Promise<User> {
  const { env } = await getCloudflareContext()
  if (!env?.DB) throw new Error("Database not available")

  const db = getDb(env.DB)

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.id, workosUser.id))
    .get()

  if (existing) return existing

  const now = new Date().toISOString()
  const newUser = {
    id: workosUser.id,
    email: workosUser.email,
    firstName: workosUser.firstName ?? null,
    lastName: workosUser.lastName ?? null,
    displayName:
      workosUser.firstName && workosUser.lastName
        ? `${workosUser.firstName} ${workosUser.lastName}`
        : workosUser.email.split("@")[0],
    avatarUrl: workosUser.profilePictureUrl ?? null,
    role: "office",
    isActive: true,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(users).values(newUser).run()
  return newUser as User
}

export async function handleSignOut() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
  redirect("/login")
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error("Unauthorized")
  return user
}

export async function requireEmailVerified(): Promise<AuthUser> {
  return requireAuth()
}
