import { NextRequest, NextResponse } from "next/server";
import { getWorkOSClient, mapWorkOSError } from "@/lib/workos-client";

export async function POST(request: NextRequest) {
  try {
    const workos = getWorkOSClient();
    const { email, password, firstName, lastName } = (await request.json()) as {
      email: string
      password: string
      firstName: string
      lastName: string
    };

    if (!workos) {
      return NextResponse.json({
        success: true,
        userId: "dev-user-" + Date.now(),
        message: "Account created (dev mode)",
      });
    }

    const user = await workos.userManagement.createUser({
      email,
      password,
      firstName,
      lastName,
      emailVerified: false,
    });

    await workos.userManagement.sendVerificationEmail({
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      userId: user.id,
      message: "Account created. Check your email to verify.",
    });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { success: false, error: mapWorkOSError(error) },
      { status: 500 }
    );
  }
}
