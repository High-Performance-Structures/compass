import { NextRequest, NextResponse } from "next/server";
import { getWorkOSClient, mapWorkOSError } from "@/lib/workos-client";

export async function POST(request: NextRequest) {
  try {
    const workos = getWorkOSClient();
    const { invitationToken } = (await request.json()) as {
      invitationToken: string
    };

    if (!workos) {
      return NextResponse.json({
        success: true,
        message: "Invitation accepted (dev mode)",
      });
    }

    // verify invitation exists and is valid
    const invitation = await workos.userManagement.getInvitation(
      invitationToken
    );

    return NextResponse.json({
      success: true,
      message: "Invitation verified",
      email: invitation.email,
    });
  } catch (error) {
    console.error("Invite acceptance error:", error);
    return NextResponse.json(
      { success: false, error: mapWorkOSError(error) },
      { status: 500 }
    );
  }
}
