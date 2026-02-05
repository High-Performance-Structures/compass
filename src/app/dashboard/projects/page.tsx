export const dynamic = "force-dynamic"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { asc } from "drizzle-orm"
import { redirect } from "next/navigation"
import { IconFolder } from "@tabler/icons-react"

export default async function ProjectsPage() {
  try {
    const { env } = await getCloudflareContext()
    if (!env?.DB) throw new Error("D1 not available")

    const db = getDb(env.DB)
    const [first] = await db
      .select({ id: projects.id })
      .from(projects)
      .orderBy(asc(projects.name))
      .limit(1)

    if (first) redirect(`/dashboard/projects/${first.id}`)
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e
  }

  return (
    <div className="flex flex-1 items-center justify-center text-center text-muted-foreground">
      <div>
        <IconFolder className="mx-auto mb-4 size-12 opacity-50" />
        <p>No projects yet.</p>
      </div>
    </div>
  )
}
