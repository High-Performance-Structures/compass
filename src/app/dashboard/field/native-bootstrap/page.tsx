import { redirect } from "next/navigation"

import {
  getActiveFieldProjects,
  getFieldProjectPacket,
} from "@/app/actions/field-mode"
import { NativeFieldBootstrap } from "@/components/field/native-field-bootstrap"
import { requireAuth } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function NativeFieldBootstrapPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly nativePlatform?: string
    readonly projectId?: string
  }>
}): Promise<React.ReactElement> {
  const { nativePlatform, projectId } = await searchParams
  if (nativePlatform !== "ios" && nativePlatform !== "android") {
    redirect("/dashboard/field")
  }

  const [user, projects] = await Promise.all([
    requireAuth(),
    getActiveFieldProjects(),
  ])
  const selectedProject =
    projects.find((project) => project.id === projectId) ?? projects[0] ?? null
  let initialPacket = null
  if (selectedProject) {
    try {
      initialPacket = await getFieldProjectPacket(selectedProject.id)
    } catch (error) {
      // The project list is still useful offline even when one packet download
      // fails, and the native shell can retry that project while connected.
      console.error("Unable to prepare the initial native field packet:", error)
    }
  }

  return (
    <NativeFieldBootstrap
      profile={{
        name: user.displayName ?? user.email.split("@")[0] ?? "Compass user",
        email: user.email,
        role: user.role,
      }}
      projects={projects}
      initialPacket={initialPacket}
    />
  )
}
