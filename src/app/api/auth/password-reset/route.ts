import { NextRequest, NextResponse } from "next/server";
import { getWorkOSClient } from "@/lib/workos-client";

export async function POST(request: NextRequest) {
  try {
    const workos = getWorkOSClient();
    const { email } = (await request.json()) as { email: string };

    if (!workos) {
      return NextResponse.json({
        success: true,
        message: "Password reset link sent (dev mode)",
      });
    }

    await workos.userManagement.createPasswordReset({ email });

    return NextResponse.json({
      success: true,
      message: "If an account exists, a reset link has been sent",
    });
  } catch (error) {
    console.error("Password reset error:", error);
    return NextResponse.json({
      success: true,
      message: "If an account exists, a reset link has been sent",
    });
  }
}
