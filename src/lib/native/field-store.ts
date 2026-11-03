import { type FieldProject, type FieldProjectPacket, type FieldUserProfile } from "@/lib/field/types"
import { isNative } from "@/lib/native/platform"

const PROJECTS_KEY = "compass_field_projects_v1"
const ACTIVE_PROJECT_KEY = "compass_field_active_project_v1"
const PACKET_PREFIX = "compass_field_packet_v1"
const PROFILE_KEY = "compass_field_profile_v1"

function packetKey(projectId: string): string {
  return `${PACKET_PREFIX}.${projectId}`
}

async function writeJson(key: string, value: unknown): Promise<void> {
  const { Preferences } = await import("@capacitor/preferences")
  await Preferences.set({ key, value: JSON.stringify(value) })
}

export async function cacheNativeFieldState(
  projects: readonly FieldProject[],
  packet: FieldProjectPacket
): Promise<void> {
  if (!isNative()) return
  await Promise.all([
    writeJson(PROJECTS_KEY, projects),
    writeJson(packetKey(packet.project.id), packet),
    writeJson(ACTIVE_PROJECT_KEY, packet.project.id),
  ])
}

export async function cacheNativeFieldProjects(
  projects: readonly FieldProject[]
): Promise<void> {
  if (!isNative()) return
  await Promise.all([
    writeJson(PROJECTS_KEY, projects),
    projects.length === 0
      ? writeJson(ACTIVE_PROJECT_KEY, null)
      : Promise.resolve(),
  ])
}

export async function cacheNativeFieldProfile(
  profile: FieldUserProfile
): Promise<void> {
  if (!isNative()) return
  await writeJson(PROFILE_KEY, profile)
}
