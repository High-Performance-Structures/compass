import { withAuth, signOut } from "@workos-inc/authkit-nextjs"
import { getDb } from "@/lib/db-universal"
import { users } from "@/db/schema"
import type { User } from "@/db/schema"
import { eq } from "drizzle-orm"

export type AuthUser = {
  readonly id: string
  readonly email: string
  readonly firstName: string | null
  readonly lastName: string | null
  readonly displayName: string | null
  readonly avatarUrl: string | null
  readonly role: string
  readonly googleEmail: string | null
  readonly isActive: boolean
  readonly lastLoginAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * User data for sidebar/header display components
 */
export type SidebarUser = Readonly<{
  id: string
  name: string
  email: string
  avatar: string | null
  firstName: string | null
  lastName: string | null
}>

/**
 * Convert AuthUser to SidebarUser for UI components
 */
export function toSidebarUser(user: AuthUser): SidebarUser {
  return {
    id: user.id,
    name: user.displayName ?? user.email.split("@")[0] ?? "User",
    email: user.email,
    avatar: user.avatarUrl,
    firstName: user.firstName,
    lastName: user.lastName,
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    // check if workos is configured
    const isWorkOSConfigured =
      process.env.WORKOS_API_KEY &&
      process.env.WORKOS_CLIENT_ID &&
      !process.env.WORKOS_API_KEY.includes("placeholder")

    if (!isWorkOSConfigured) {
      // return mock user for development
      const mockUser = {
        id: "dev-user-1",
        email: "dev@compass.io",
        firstName: "Dev",
        lastName: "User",
        displayName: "Dev User",
        avatarUrl: null,
        role: "admin",
        googleEmail: null,
        isActive: true,
        lastLoginAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      // Ensure mock user exists in DB to prevent FK errors
      try {
        const db = (await getDb()) as any // eslint-disable-line @typescript-eslint/no-explicit-any
        const existing = await db
          .select()
          .from(users)
          .where(eq(users.id, mockUser.id))
          .get()

        if (!existing) {
          await db.insert(users).values(mockUser).run()
        }
      } catch (e) {
        console.error("Failed to ensure mock user exists:", e)
      }

      return mockUser
    }

    const session = await withAuth()
    if (!session || !session.user) return null

    const workosUser = session.user

    const db = (await getDb()) as any // eslint-disable-line @typescript-eslint/no-explicit-any

    // check if user exists in our database
    let dbUser = await db
      .select()
      .from(users)
      .where(eq(users.id, workosUser.id))
      .get()

    // if user doesn't exist, create them with default role
    if (!dbUser) {
      dbUser = await ensureUserExists(workosUser)
    }

    // update last login timestamp
    const now = new Date().toISOString()
    await db
      .update(users)
      .set({ lastLoginAt: now })
      .where(eq(users.id, workosUser.id))
      .run()

    return {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      displayName: dbUser.displayName,
      avatarUrl: dbUser.avatarUrl,
      role: dbUser.role,
      googleEmail: dbUser.googleEmail ?? null,
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
  const db = (await getDb()) as any // eslint-disable-line @typescript-eslint/no-explicit-any

  // Check if user already exists
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
    role: "office", // default role
    isActive: true,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(users).values(newUser).run()

  return newUser as User
}

export async function handleSignOut() {
  await signOut()
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error("Unauthorized")
  }
  return user
}

export async function requireEmailVerified(): Promise<AuthUser> {
  const user = await requireAuth()

  // check verification status
  const isWorkOSConfigured =
    process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    !process.env.WORKOS_API_KEY.includes("placeholder")

  if (isWorkOSConfigured) {
    const session = await withAuth()
    if (session?.user && !session.user.emailVerified) {
      throw new Error("Email not verified")
    }
  }

  return user
}
