import { sendNotificationDigests } from "@/lib/notifications/digest-server"
import { signedMaintenanceRoute } from "@/lib/server/signed-maintenance-route"

/** Scheduled: sends each person one summary of the change notices held since the last digest time. */
export async function POST(request: Request): Promise<Response> {
  return signedMaintenanceRoute(request, "Notification digest failed", (db, env) =>
    sendNotificationDigests(db, env)
  )
}
