import { NextRequest, NextResponse } from "next/server"

import {
  getActiveFieldProjects,
  getFieldProjectPacket,
} from "@/app/actions/field-mode"
import { requireAuth } from "@/lib/auth"
import { DEPARTMENT_CODES } from "@/lib/department-profiles"
import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import type { FieldProjectPacket } from "@/lib/field/types"

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const requestedProjectId = request.nextUrl.searchParams.get("projectId")
    const [user, projects, departmentProfiles] = await Promise.all([
      requireAuth(),
      getActiveFieldProjects(),
      currentDepartmentProfiles(),
    ])
    const selectedProject =
      projects.find((project) => project.id === requestedProjectId) ??
      projects[0] ??
      null
    let initialPacket: FieldProjectPacket | null = null
    if (selectedProject) {
      try {
        initialPacket = await getFieldProjectPacket(selectedProject.id)
      } catch (error) {
        // A project list and signed-in profile still make Field Mode usable;
        // the shell can retry the selected packet without losing the session.
        console.error("Unable to prepare the native field packet:", error)
      }
    }

    return NextResponse.json({
      success: true,
      profile: {
        name: user.displayName ?? user.email.split("@")[0] ?? "Compass user",
        email: user.email,
        role: user.role,
      },
      projects,
      initialPacket,
      // Field Mode shows each project's company name and logo, offline too.
      companies: Object.fromEntries(
        DEPARTMENT_CODES.map((code) => [
          code,
          {
            displayName: departmentProfiles[code].displayName,
            shortName: departmentProfiles[code].shortName,
            logoDataUrl: departmentProfiles[code].logoDataUrl,
          },
        ])
      ),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to prepare Field Mode."
    return NextResponse.json(
      { success: false, error: message },
      { status: message === "Unauthorized" ? 401 : 500 }
    )
  }
}
