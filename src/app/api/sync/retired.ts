import { NextResponse } from "next/server"

/**
 * The offline sync endpoints (checkpoint, delta, mutate) were retired on
 * 2026-10-30. No web, mobile, or desktop client called them, and the
 * generic mutate path bypassed the domain rules and checked a
 * caller-supplied organization rather than the record's own. Restore from
 * git history only behind the shared action context.
 */
export function retiredSyncEndpoint(): NextResponse {
  return NextResponse.json(
    { error: "The sync API has been retired." },
    { status: 410 }
  )
}
