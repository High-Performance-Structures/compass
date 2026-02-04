import { NextRequest, NextResponse } from "next/server";
import { getWorkOSClient, mapWorkOSError } from "@/lib/workos-client";

export async function POST(request: NextRequest) {
  try {
    const workos = getWorkOSClient();
    const { code, userId } = (await request.json()) as {
      code: string
      userId: string
    };

    if (!workos) {
      return NextResponse.json({
        success: true,
        message: "Email verified (dev mode)",
      });
    }

    await workos.userManagement.verifyEmail({ userId, code });

    return NextResponse.json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    console.error("Email verification error:", error);
    return NextResponse.json(
      { success: false, error: mapWorkOSError(error) },
      { status: 500 }
    );
  }
}
