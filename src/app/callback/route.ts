import { handleAuth } from "@workos-inc/authkit-nextjs"
import { NextRequest, NextResponse } from "next/server"
import { ensureUserExists } from "@/lib/auth"

function loginRedirect(request: NextRequest, parameter: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?${parameter}`, request.url))
}

const handlePkceCallback = handleAuth({
  returnPathname: "/dashboard",
  onSuccess: async ({ user }) => {
    // sync user to our database on successful auth
    await ensureUserExists({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePictureUrl: user.profilePictureUrl,
    })
  },
  onError: async ({ request }) => loginRedirect(request, "error=auth_failed"),
})

export async function GET(request: NextRequest): Promise<Response> {
  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")

  // Hosted password reset returns a code without the PKCE state established by
  // a normal sign-in. Do not weaken CSRF protection by exchanging that code;
  // the password is already updated, so ask the user to sign in explicitly.
  if (code && !state) {
    return loginRedirect(request, "notice=password_reset_complete")
  }

  return handlePkceCallback(request)
}
