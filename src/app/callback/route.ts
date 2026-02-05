import { handleAuth } from "@workos-inc/authkit-nextjs"
import { ensureUserExists } from "@/lib/auth"

export const GET = handleAuth({
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
})
