import { NextResponse, type NextRequest } from "next/server"
import { safeBrowserDestination } from "@/lib/native/browser-handoff"

// Browser handoff from the iOS and Android apps. Middleware has already
// required sign-in, so this only forwards to the requested Compass page.
export function GET(request: NextRequest): NextResponse {
  const destination = safeBrowserDestination(request.nextUrl.searchParams.get("to"))
  return NextResponse.redirect(new URL(destination, request.url))
}
