import { describe, expect, it } from "vitest"

import { hasActiveExternalProjectResourceGrant } from "@/lib/project-external-resource-access"

function fakeDb(rows: readonly unknown[]) {
  const chain = {
    from() {
      return chain
    },
    innerJoin() {
      return chain
    },
    where() {
      return chain
    },
    limit() {
      return Promise.resolve(rows)
    },
  }
  return {
    select() {
      return chain
    },
  } as unknown as ReturnType<typeof import("@/db").getDb>
}

describe("external project resource access", () => {
  it("requires a current grant for the requested audience and resource", async () => {
    await expect(
      hasActiveExternalProjectResourceGrant({
        db: fakeDb([{ id: "grant-1" }]),
        organizationId: "org-1",
        projectId: "project-1",
        recipientUserId: "user-1",
        resourceId: "photo-1",
        resourceType: "photo",
        audience: "owner",
      })
    ).resolves.toBe(true)
  })

  it("denies missing or revoked grants without treating membership as enough", async () => {
    await expect(
      hasActiveExternalProjectResourceGrant({
        db: fakeDb([]),
        organizationId: "org-1",
        projectId: "project-1",
        recipientUserId: "user-1",
        resourceId: "photo-1",
        resourceType: "photo",
        audience: "owner",
      })
    ).resolves.toBe(false)
  })
})
