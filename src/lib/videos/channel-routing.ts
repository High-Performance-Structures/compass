import type { ProjectDepartment } from "@/lib/project-branding"

export type YoutubeChannelKey = "orc" | "hps" | "nutech"

export function youtubeChannelForDepartment(
  department: ProjectDepartment
): YoutubeChannelKey {
  if (department === "H") return "hps"
  if (department === "N") return "nutech"
  return "orc"
}
