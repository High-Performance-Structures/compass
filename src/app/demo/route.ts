import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { isDevAuthFallbackAllowed, isE2ETest } from "@/lib/auth-config"

export async function GET() {
  const cookieStore = await cookies()
  // The read-only demo session is for local development and E2E runs only.
  // In production it would hand anyone a signed-in session without a login.
  if (!isDevAuthFallbackAllowed()) {
    cookieStore.delete("compass-demo")
    redirect("/login")
  }
  cookieStore.set("compass-demo", "true", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && !isE2ETest(),
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
  })
  // clear stale org preference so demo doesn't inherit
  // a real user's last-active workspace
  cookieStore.delete("compass-active-org")
  redirect("/dashboard")
}
