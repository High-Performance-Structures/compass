// google drive REST API v3 wrapper.
// each method accepts userEmail for domain-wide delegation impersonation.

import {
  GOOGLE_DRIVE_API,
  GOOGLE_UPLOAD_API,
  type ServiceAccountKey,
} from "../config"
import {
  getAccessToken,
} from "../auth/service-account"
import {
  getCachedToken,
  setCachedToken,
  clearCachedToken,
} from "../auth/token-cache"
import { ConcurrencyLimiter } from "@/lib/netsuite/rate-limiter/concurrency-limiter"
import {
  DRIVE_FILE_FIELDS,
  DRIVE_LIST_FIELDS,
  type DriveFile,
  type DriveFileList,
  type DriveAbout,
  type DriveSharedDriveList,
  type ListFilesOptions,
  type UploadOptions,
} from "./types"

const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000

type DriveClientConfig = {
  readonly serviceAccountKey: ServiceAccountKey
  readonly limiter?: ConcurrencyLimiter
}

export class DriveClient {
  private serviceAccountKey: ServiceAccountKey
  private limiter: ConcurrencyLimiter

  constructor(config: DriveClientConfig) {
    this.serviceAccountKey = config.serviceAccountKey
    this.limiter = config.limiter ?? new ConcurrencyLimiter(10)
  }

  private async getToken(userEmail: string): Promise<string> {
    const cached = getCachedToken(userEmail)
    if (cached) return cached

    const token = await getAccessToken(
      this.serviceAccountKey,
      userEmail
    )
    setCachedToken(userEmail, token, 3600)
    return token
  }

  private async request<T>(
    userEmail: string,
    path: string,
    options: RequestInit = {},
    isUpload = false
  ): Promise<T> {
    return this.limiter.execute(async () => {
      let lastError: Error | null = null

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const token = await this.getToken(userEmail)
        const baseUrl = isUpload
          ? GOOGLE_UPLOAD_API
          : GOOGLE_DRIVE_API

        const response = await fetch(`${baseUrl}${path}`, {
          ...options,
          headers: {
            Authorization: `Bearer ${token}`,
            ...options.headers,
          },
        })

        if (response.ok) {
          if (response.status === 204) return undefined as T
          return response.json() as Promise<T>
        }

        // refresh token on 401
        if (response.status === 401) {
          clearCachedToken(userEmail)
          continue
        }

        // retry on rate limit or server error
        if (
          response.status === 429 ||
          response.status >= 500
        ) {
          if (response.status === 429) {
            this.limiter.reduceConcurrency()
          }
          const backoff =
            INITIAL_BACKOFF_MS * Math.pow(2, attempt)
          await new Promise(r => setTimeout(r, backoff))
          lastError = new Error(
            `Google API ${response.status}: ${await response.text()}`
          )
          continue
        }

        // non-retryable error
        const body = await response.text()
        throw new Error(
          `Google Drive API error (${response.status}): ${body}`
        )
      }

      throw lastError ?? new Error("Max retries exceeded")
    })
  }

  async listFiles(
    userEmail: string,
    options: ListFilesOptions = {}
  ): Promise<DriveFileList> {
    const params = new URLSearchParams({
      fields: DRIVE_LIST_FIELDS,
      pageSize: String(options.pageSize ?? 100),
    })

    const queryParts: string[] = []

    if (options.folderId) {
      queryParts.push(`'${options.folderId}' in parents`)
    }

    if (options.trashed !== undefined) {
      queryParts.push(`trashed = ${options.trashed}`)
    } else {
      queryParts.push("trashed = false")
    }

    if (options.sharedWithMe) {
      queryParts.push("sharedWithMe = true")
    }

    if (options.query) {
      queryParts.push(options.query)
    }

    if (queryParts.length > 0) {
      params.set("q", queryParts.join(" and "))
    }

    if (options.orderBy) {
      params.set("orderBy", options.orderBy)
    }

    if (options.pageToken) {
      params.set("pageToken", options.pageToken)
    }

    if (options.driveId) {
      params.set("driveId", options.driveId)
      params.set("corpora", "drive")
      params.set("includeItemsFromAllDrives", "true")
      params.set("supportsAllDrives", "true")
    }

    return this.request<DriveFileList>(
      userEmail,
      `/files?${params.toString()}`
    )
  }

  async getFile(
    userEmail: string,
    fileId: string
  ): Promise<DriveFile> {
    const params = new URLSearchParams({
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: "true",
    })
    return this.request<DriveFile>(
      userEmail,
      `/files/${fileId}?${params.toString()}`
    )
  }

  async createFolder(
    userEmail: string,
    options: {
      readonly name: string
      readonly parentId?: string
      readonly driveId?: string
    }
  ): Promise<DriveFile> {
    const metadata: Record<string, unknown> = {
      name: options.name,
      mimeType: "application/vnd.google-apps.folder",
    }

    if (options.parentId) {
      metadata.parents = [options.parentId]
    } else if (options.driveId) {
      metadata.parents = [options.driveId]
    }

    const params = new URLSearchParams({
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: "true",
    })

    return this.request<DriveFile>(
      userEmail,
      `/files?${params.toString()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      }
    )
  }

  async initiateResumableUpload(
    userEmail: string,
    options: UploadOptions
  ): Promise<string> {
    // returns the resumable upload session URI
    return this.limiter.execute(async () => {
      const token = await this.getToken(userEmail)

      const metadata: Record<string, unknown> = {
        name: options.name,
        mimeType: options.mimeType,
      }
      if (options.parentId) {
        metadata.parents = [options.parentId]
      } else if (options.driveId) {
        metadata.parents = [options.driveId]
      }

      const params = new URLSearchParams({
        uploadType: "resumable",
        supportsAllDrives: "true",
        fields: DRIVE_FILE_FIELDS,
      })

      const response = await fetch(
        `${GOOGLE_UPLOAD_API}/files?${params.toString()}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Type": options.mimeType,
          },
          body: JSON.stringify(metadata),
        }
      )

      if (!response.ok) {
        const body = await response.text()
        throw new Error(
          `Failed to initiate upload (${response.status}): ${body}`
        )
      }

      const location = response.headers.get("Location")
      if (!location) {
        throw new Error("No upload URI in response")
      }

      return location
    })
  }

  async downloadFile(
    userEmail: string,
    fileId: string
  ): Promise<Response> {
    const token = await this.getToken(userEmail)
    const params = new URLSearchParams({
      alt: "media",
      supportsAllDrives: "true",
    })

    return fetch(
      `${GOOGLE_DRIVE_API}/files/${fileId}?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    )
  }

  async exportFile(
    userEmail: string,
    fileId: string,
    exportMimeType: string
  ): Promise<Response> {
    const token = await this.getToken(userEmail)
    const params = new URLSearchParams({
      mimeType: exportMimeType,
    })

    return fetch(
      `${GOOGLE_DRIVE_API}/files/${fileId}/export?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    )
  }

  async renameFile(
    userEmail: string,
    fileId: string,
    newName: string
  ): Promise<DriveFile> {
    const params = new URLSearchParams({
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: "true",
    })

    return this.request<DriveFile>(
      userEmail,
      `/files/${fileId}?${params.toString()}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      }
    )
  }

  async moveFile(
    userEmail: string,
    fileId: string,
    newParentId: string,
    oldParentId: string
  ): Promise<DriveFile> {
    const params = new URLSearchParams({
      addParents: newParentId,
      removeParents: oldParentId,
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: "true",
    })

    return this.request<DriveFile>(
      userEmail,
      `/files/${fileId}?${params.toString()}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    )
  }

  async trashFile(
    userEmail: string,
    fileId: string
  ): Promise<DriveFile> {
    const params = new URLSearchParams({
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: "true",
    })

    return this.request<DriveFile>(
      userEmail,
      `/files/${fileId}?${params.toString()}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      }
    )
  }

  async restoreFile(
    userEmail: string,
    fileId: string
  ): Promise<DriveFile> {
    const params = new URLSearchParams({
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: "true",
    })

    return this.request<DriveFile>(
      userEmail,
      `/files/${fileId}?${params.toString()}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: false }),
      }
    )
  }

  async getStorageQuota(
    userEmail: string
  ): Promise<DriveAbout> {
    return this.request<DriveAbout>(
      userEmail,
      "/about?fields=storageQuota,user"
    )
  }

  async searchFiles(
    userEmail: string,
    searchQuery: string,
    pageSize = 50,
    driveId?: string
  ): Promise<DriveFileList> {
    return this.listFiles(userEmail, {
      query: `fullText contains '${searchQuery.replace(/'/g, "\\'")}'`,
      pageSize,
      driveId,
    })
  }

  async listSharedDrives(
    userEmail: string
  ): Promise<DriveSharedDriveList> {
    return this.request<DriveSharedDriveList>(
      userEmail,
      "/drives?pageSize=100"
    )
  }
}
