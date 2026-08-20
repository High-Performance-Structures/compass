import { COMPASS_DEPLOYMENT_ID } from "@/lib/deployment/version"

export const dynamic = "force-dynamic"

export function GET(): Response {
  return Response.json(
    { deploymentId: COMPASS_DEPLOYMENT_ID },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  )
}
