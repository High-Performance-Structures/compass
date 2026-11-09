import { currentServerVersion } from "@/lib/deployment/server-version"

export const dynamic = "force-dynamic"

// Answers "which Compass version is live?" for open tabs. Tabs never tag this
// request with their own version (src/lib/deployment/version-pin.ts), so the
// answer always comes from the newest version. `liveAt` starts the update
// countdown in every older tab (src/lib/deployment/update-window.ts).
export async function GET(): Promise<Response> {
  return Response.json(await currentServerVersion(new Date()), {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  })
}
