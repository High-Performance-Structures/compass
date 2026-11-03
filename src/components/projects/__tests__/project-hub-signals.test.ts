import { describe, expect, it } from "vitest"

import type { DashboardOverview } from "@/app/actions/dashboard-overview"
import {
  projectHubHealth,
  projectHubPhoto,
  projectHubSignals,
} from "@/components/projects/project-hub-signals"

type OverviewProject = DashboardOverview["projects"][number]
type OverviewPhoto = DashboardOverview["fieldPhotos"][number]

function project(id: string, values: Partial<OverviewProject> = {}): OverviewProject {
  return {
    id,
    name: `Project ${id}`,
    projectNumber: null,
    clientName: null,
    status: "active",
    sageJobId: null,
    sageJobNumber: null,
    googleDriveFolderId: null,
    progress: 0,
    activeTaskCount: 0,
    nextTask: null,
    photosToReview: 0,
    ownerVisiblePhotos: 0,
    latestLog: null,
    latestOwnerUpdate: null,
    openPoCount: 0,
    openPoAmount: 0,
    activeCommitmentCount: 0,
    openRfiCount: 0,
    ...values,
  }
}

function photo(id: string, projectId: string): OverviewPhoto {
  return {
    id,
    projectId,
    projectLabel: projectId,
    projectName: projectId,
    fileName: `${id}.jpg`,
    imageUrl: `https://example.test/${id}.jpg`,
    driveUrl: null,
    caption: id === "p2" ? null : `Caption ${id}`,
    capturedAt: null,
    photoKind: "progress",
  }
}

function overview(
  projects: readonly OverviewProject[],
  fieldPhotos: readonly OverviewPhoto[],
): Pick<DashboardOverview, "projects" | "fieldPhotos"> {
  return { projects, fieldPhotos }
}

describe("project hub signals", () => {
  const signals = projectHubSignals(
    overview(
      [
        project("a", {
          progress: 40,
          openRfiCount: 2,
          openPoCount: 1,
          nextTask: {
            id: "t1",
            projectId: "a",
            projectLabel: "A",
            title: "Frame walls",
            startDate: "2026-11-02",
            endDate: "2026-11-04",
            assignedTo: null,
            status: "PENDING",
          },
        }),
        project("b"),
        project("a", { progress: 99 }),
      ],
      [photo("p1", "a"), photo("p2", "a"), photo("p3", "b")],
    ),
  )

  it("keeps only the fields the cards read, first match wins as before", () => {
    expect(projectHubHealth(signals, "a")).toEqual({
      progress: 40,
      openRfiCount: 2,
      openPoCount: 1,
      nextTaskTitle: "Frame walls",
    })
    expect(projectHubHealth(signals, "b")).toEqual({
      progress: 0,
      openRfiCount: 0,
      openPoCount: 0,
      nextTaskTitle: null,
    })
  })

  it("returns null for projects the overview does not include", () => {
    expect(projectHubHealth(signals, "missing")).toBeNull()
    expect(projectHubHealth(signals, "toString")).toBeNull()
    expect(projectHubPhoto(signals, "missing")).toBeNull()
  })

  it("keeps the first field photo per project", () => {
    expect(projectHubPhoto(signals, "a")).toEqual({
      imageUrl: "https://example.test/p1.jpg",
      caption: "Caption p1",
      fileName: "p1.jpg",
    })
    expect(projectHubPhoto(signals, "b")?.imageUrl).toBe("https://example.test/p3.jpg")
  })
})
