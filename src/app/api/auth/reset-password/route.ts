import { NextRequest, NextResponse } from "next/server";
import { getWorkOSClient, mapWorkOSError } from "@/lib/workos-client";

export async function POST(request: NextRequest) {
  try {
    const workos = getWorkOSClient();
    const { token, newPassword } = (await request.json()) as {
      token: string
      newPassword: string
    };

    if (!workos) {
      return NextResponse.json({
        success: true,
        message: "Password reset successful (dev mode)",
      });
    }

    await workos.userManagement.resetPassword({ token, newPassword });

    return NextResponse.json({
      success: true,
      message: "Password reset successful",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { success: false, error: mapWorkOSError(error) },
      { status: 500 }
    );
  }
}
