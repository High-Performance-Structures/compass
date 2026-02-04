import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";

const isWorkOSConfigured =
  process.env.WORKOS_API_KEY &&
  process.env.WORKOS_CLIENT_ID &&
  process.env.WORKOS_COOKIE_PASSWORD &&
  !process.env.WORKOS_API_KEY.includes("placeholder");

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // bypass auth in dev mode
  if (!isWorkOSConfigured) {
    return NextResponse.next();
  }

  // public routes (no auth required)
  const publicRoutes = [
    "/login",
    "/signup",
    "/reset-password",
    "/verify-email",
    "/invite",
    "/api/auth",
  ];

  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // check session for protected routes
  try {
    const session = await withAuth();
    if (!session || !session.user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
  } catch {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // add security headers
  const response = NextResponse.next();
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
