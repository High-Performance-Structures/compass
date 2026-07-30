import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { isE2ETest } from "@/lib/auth-config"

export async function GET() {
  const cookieStore = await cookies()
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
