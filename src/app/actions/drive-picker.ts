"use server"

import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import { requireOrg } from "@/lib/org-scope"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  DRIVE_FOLDER_MIME_TYPE,
  driveItemUrl,
  type DrivePickerDestination,
  type DrivePickerItem,
  type DrivePickerLocation,
} from "@/lib/google/drive-picker"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

async function pickerDrive() {
  const user = await requireAuth()
  if (!isInternalStaffRole(user.role)) throw new Error("Browsing Drive is for office staff.")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const drive = await getOrganizationDriveContext({ db, environment: env, organizationId, user })
  return { ...drive, db, organizationId }
}

/** The calling page's origin, so Google lets the browser PUT straight to the upload session. */
async function requestOrigin(): Promise<string | undefined> {
  const requestHeaders = await headers()
  const origin = requestHeaders.get("origin")
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  if (!host) return undefined
  return `${requestHeaders.get("x-forwarded-proto") ?? "https"}://${host}`
}

function driveQueryText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function toItem(file: { readonly id: string; readonly name: string; readonly mimeType: string; readonly modifiedTime?: string; readonly webViewLink?: string }): DrivePickerItem {
  const kind = file.mimeType === DRIVE_FOLDER_MIME_TYPE ? "folder" : "file"
  return {
    id: file.id,
    name: file.name,
    kind,
    mimeType: file.mimeType,
    modifiedAt: file.modifiedTime ?? null,
    url: file.webViewLink ?? driveItemUrl(file.id, kind),
  }
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** One folder of the signed-in person's Drive, folders first, for the Browse Drive dialog. */
export async function listDrivePickerFolder(location: DrivePickerLocation): Promise<Result<readonly DrivePickerItem[]>> {
  try {
    const drive = await pickerDrive()
    const page = await drive.client.listFiles(drive.userEmail, {
      ...(location.kind === "shared" ? { sharedWithMe: true } : { folderId: location.kind === "folder" ? location.id : "root" }),
      orderBy: "folder,name",
      pageSize: 500,
    })
    return { success: true, data: page.files.map(toItem) }
  } catch (error) {
    return { success: false, error: message(error, "Could not open that Drive folder.") }
  }
}

/** Files and folders whose name matches, anywhere the person can see in Drive. */
export async function searchDrivePicker(query: string): Promise<Result<readonly DrivePickerItem[]>> {
  const needle = query.trim().slice(0, 100)
  if (needle.length < 2) return { success: true, data: [] }
  try {
    const drive = await pickerDrive()
    const page = await drive.client.listFiles(drive.userEmail, {
      query: `name contains '${driveQueryText(needle)}'`,
      orderBy: "folder,modifiedTime desc",
      pageSize: 50,
    })
    return { success: true, data: page.files.map(toItem) }
  } catch (error) {
    return { success: false, error: message(error, "Drive search failed.") }
  }
}

/** Name of an already chosen Drive file or folder, so fields can show it instead of a bare link. */
export async function getDrivePickerItem(id: string): Promise<Result<DrivePickerItem>> {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return { success: false, error: "Not a Drive file." }
  try {
    const drive = await pickerDrive()
    return { success: true, data: toItem(await drive.client.getFile(drive.userEmail, id)) }
  } catch (error) {
    return { success: false, error: message(error, "Could not find that Drive file.") }
  }
}

/**
 * A file already in Drive with the same name and size, so an upload from the
 * computer can reuse it instead of making a second copy.
 */
export async function findDriveDuplicate(name: string, size: number): Promise<Result<DrivePickerItem | null>> {
  const trimmed = name.trim().slice(0, 250)
  if (!trimmed) return { success: true, data: null }
  try {
    const drive = await pickerDrive()
    const page = await drive.client.listFiles(drive.userEmail, { query: `name = '${driveQueryText(trimmed)}'`, pageSize: 20 })
    const match = page.files.find((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE && Number(file.size ?? -1) === size)
    return { success: true, data: match ? toItem(match) : null }
  } catch (error) {
    return { success: false, error: message(error, "Could not check Drive for this file.") }
  }
}

/** Starts a browser upload into Drive: the chosen folder, the project's folder, or My Drive. */
export async function startDrivePickerUpload(
  name: string,
  mimeType: string,
  destination: DrivePickerDestination,
): Promise<Result<{ readonly uploadUrl: string }>> {
  const fileName = name.trim().slice(0, 250)
  if (!fileName) return { success: false, error: "Choose a file to upload." }
  try {
    const drive = await pickerDrive()
    let parentId: string | undefined
    if (destination.kind === "folder") parentId = destination.id
    else if (destination.kind === "project") {
      const project = await drive.db
        .select({ folderId: projects.googleDriveFolderId })
        .from(projects)
        .where(and(eq(projects.id, destination.projectId), eq(projects.organizationId, drive.organizationId)))
        .get()
      if (!project?.folderId) return { success: false, error: "Connect this project to its Google Drive folder first." }
      parentId = project.folderId
    }
    const uploadUrl = await drive.client.initiateResumableUpload(drive.userEmail, {
      name: fileName,
      mimeType: mimeType || "application/octet-stream",
      parentId,
      browserOrigin: await requestOrigin(),
    })
    return { success: true, data: { uploadUrl } }
  } catch (error) {
    return { success: false, error: message(error, "Could not start the upload.") }
  }
}
