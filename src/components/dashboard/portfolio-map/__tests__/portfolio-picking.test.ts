// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Raycaster,
  Vector2,
  Vector3,
} from "three"
import { buildMessageStacks } from "../portfolio-message-stacks"
import { pickPortfolioTarget } from "../portfolio-picking"
import { messageStacksFrom } from "@/lib/notifications/message-stacks"

const colors = { message: 1, mail: 2, rfi: 3, schedule: 4, other: 5 }

describe("portfolio notification picking", () => {
  it("keeps each exact source on its raycast tile after kind sorting", () => {
    const stacks = messageStacksFrom([
      { id: "rfi-1", sourceType: "rfi", eventType: "rfi.created", projectId: "p1", readAt: null },
      {
        id: "mail-1",
        sourceType: "project_correspondence",
        eventType: "project_message",
        projectId: "p1",
        readAt: null,
      },
    ])
    const built = buildMessageStacks(stacks, new Map([["p1", new Vector3(0, 0, 0)]]), colors)
    const canvas = document.createElement("canvas")
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 200))
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 20)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    built.group.updateMatrixWorld(true)
    try {
      expect(built.meshes.map((tile) => tile.userData.notificationId)).toEqual(["mail-1", "rfi-1"])
      for (const tile of built.meshes) {
        const point = tile.position.clone().project(camera)
        const hit = pickPortfolioTarget(
          { clientX: (point.x + 1) * 200, clientY: (1 - point.y) * 100 },
          canvas,
          new Vector2(),
          new Raycaster(),
          camera,
          [],
          built.meshes,
        )
        expect(hit).toEqual({ jobId: "p1", notificationId: tile.userData.notificationId })
      }
    } finally {
      built.dispose()
    }
  })

  it("selects a project marker without inventing a notification source", () => {
    const canvas = document.createElement("canvas")
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 200))
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 20)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const marker = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial())
    marker.userData.jobId = "p1"
    marker.updateMatrixWorld(true)
    try {
      expect(
        pickPortfolioTarget(
          { clientX: 200, clientY: 100 },
          canvas,
          new Vector2(),
          new Raycaster(),
          camera,
          [marker],
          [],
        ),
      ).toEqual({ jobId: "p1", notificationId: null })
      expect(
        pickPortfolioTarget(
          { clientX: 0, clientY: 0 },
          canvas,
          new Vector2(),
          new Raycaster(),
          camera,
          [marker],
          [],
        ),
      ).toBeNull()
    } finally {
      marker.geometry.dispose()
      marker.material.dispose()
    }
  })
})
