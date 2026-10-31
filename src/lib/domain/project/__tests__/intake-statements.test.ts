import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { projectExternalLinks, projects } from "@/db/schema"
import { projectFamilies, projectFamilyPhases } from "@/db/schema-project-families"
import { driveProvisionedStatements, type DriveProvisioningTarget } from "@/lib/domain/project/drive-provisioning"
import { intakeDriveReceiptStatements } from "@/lib/domain/project/intake"
import { projectDriveTemplateFolderId } from "@/lib/google/project-drive-provisioning"

/*
 * The intake and Drive statements now come from the project store; each is
 * compared with the drizzle chain projects.ts wrote before the move.
 */
// @ts-expect-error Statements are only built here, never run.
const db = getDb({})

function sqlOf(statement: object): unknown {
  return Reflect.apply(Reflect.get(statement, "getSQL"), statement, [])
}

const now = "2026-10-31T12:00:00.000Z"
const drive = {
  folderId: "f1",
  folderUrl: "https://drive.google.com/drive/folders/f1",
  folderName: "O-1-12 Lee",
  parentFolderId: "parent",
  childFolderNames: ["01 Contracts"],
  copiedFileCount: 2,
  createdRoot: true,
  createdChildCount: 1,
}

describe("intake Drive receipt", () => {
  it("updates the project and its Drive link with the same SQL", () => {
    const [projectUpdate, linkUpdate] = intakeDriveReceiptStatements(db, {
      projectId: "p1",
      driveLinkId: "l1",
      department: "O",
      drive,
      syncedAt: now,
    })
    expect(sqlOf(projectUpdate)).toEqual(
      db.update(projects).set({ googleDriveFolderId: "f1", updatedAt: now }).where(eq(projects.id, "p1")).getSQL(),
    )
    expect(sqlOf(linkUpdate)).toEqual(
      db.update(projectExternalLinks).set({
        externalId: "f1",
        externalUrl: drive.folderUrl,
        syncStatus: "mapped",
        lastSyncedAt: now,
        metadata: JSON.stringify({
          department: "O",
          folderName: drive.folderName,
          parentFolderId: drive.parentFolderId,
          templateFolderId: projectDriveTemplateFolderId("O"),
          childFolderNames: drive.childFolderNames,
          copiedFileCount: drive.copiedFileCount,
        }),
        updatedAt: now,
      }).where(eq(projectExternalLinks.id, "l1")).getSQL(),
    )
  })
})

describe("Drive provisioning writes", () => {
  const target: DriveProvisioningTarget = {
    ok: true,
    project: { id: "p1", projectNumber: "O-1-12", name: "Lee", googleDriveFolderId: null },
    familyPhase: { phaseId: "ph1", familyId: "fam1", sequence: 1, phaseFolderId: null, familyFolderId: null },
    familyParentFolderId: null,
    department: "O",
    driveLink: { id: "l1", metadata: null },
    folderName: "O-1-12 Lee",
  }

  it("writes the phase, the first phase's family, and the existing link", () => {
    const writes = driveProvisionedStatements(db, { target, drive, now })
    expect(writes.familyWrites).toHaveLength(2)
    expect(sqlOf(writes.familyWrites[0])).toEqual(
      db.update(projectFamilyPhases)
        .set({ projectNumber: "O-1-12", googleDriveFolderId: "f1", updatedAt: now })
        .where(eq(projectFamilyPhases.id, "ph1")).getSQL(),
    )
    expect(sqlOf(writes.familyWrites[1])).toEqual(
      db.update(projectFamilies)
        .set({ googleDriveFolderId: "f1", updatedAt: now })
        .where(eq(projectFamilies.id, "fam1")).getSQL(),
    )
    expect(sqlOf(writes.projectUpdate)).toEqual(
      db.update(projects).set({ googleDriveFolderId: "f1", updatedAt: now }).where(eq(projects.id, "p1")).getSQL(),
    )
  })

  it("leaves the family alone for a later phase and inserts a missing link", () => {
    const later: DriveProvisioningTarget = {
      ...target,
      familyPhase: { phaseId: "ph2", familyId: "fam1", sequence: 2, phaseFolderId: null, familyFolderId: "ff" },
      familyParentFolderId: "ff",
      driveLink: null,
    }
    const writes = driveProvisionedStatements(db, { target: later, drive, now })
    expect(writes.familyWrites).toHaveLength(1)
    const query: unknown = Reflect.apply(Reflect.get(writes.linkWrite, "toSQL"), writes.linkWrite, [])
    expect(query).toMatchObject({ sql: expect.stringMatching(/^insert into "project_external_links"/) })
  })
})
