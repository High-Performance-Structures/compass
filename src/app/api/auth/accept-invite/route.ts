import { NextRequest, NextResponse } from "next/server"
import { getWorkOS } from "@workos-inc/authkit-nextjs"
import { z } from "zod"

const acceptInviteSchema = z.object({
  invitationToken: z.string().min(1, "Invitation token is required"),
})

function mapWorkOSError(error: unknown): string {
  const err = error as { code?: string; message?: string }
  switch (err.code) {
    case "invitation_not_found":
      return "Invitation not found or has expired."
    case "invitation_expired":
      return "This invitation has expired. Please request a new one."
    default:
      return err.message || "An error occurred. Please try again."
  }
}

export async function POST(request: NextRequest) {
  try {
    // validate input
    const body = await request.json()
    const parseResult = acceptInviteSchema.safeParse(body)

    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0]
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "Invalid input" },
        { status: 400 }
      )
    }

    const { invitationToken } = parseResult.data

    // check if workos is configured
    const isConfigured =
      process.env.WORKOS_API_KEY &&
      process.env.WORKOS_CLIENT_ID &&
      !process.env.WORKOS_API_KEY.includes("placeholder")

    if (!isConfigured) {
      return NextResponse.json({
        success: true,
        message: "Invitation accepted (dev mode)",
      })
    }

    const workos = getWorkOS()
    // verify invitation exists and is valid
    const invitation = await workos.userManagement.getInvitation(invitationToken)

    return NextResponse.json({
      success: true,
      message: "Invitation verified",
      email: invitation.email,
    })
  } catch (error) {
    console.error("Invite acceptance error:", error)
    return NextResponse.json(
      { success: false, error: mapWorkOSError(error) },
      { status: 500 }
    )
  }
}
