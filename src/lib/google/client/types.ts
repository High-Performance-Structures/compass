// google drive API v3 response types

export type DriveUser = {
  readonly displayName: string
  readonly photoLink?: string
  readonly emailAddress?: string
}

export type DrivePermission = {
  readonly id: string
  readonly type: string
  readonly role: string
  readonly emailAddress?: string
  readonly displayName?: string
  readonly photoLink?: string
}

export type DriveFile = {
  readonly id: string
  readonly name: string
  readonly mimeType: string
  readonly size?: string
  readonly createdTime?: string
  readonly modifiedTime?: string
  readonly owners?: ReadonlyArray<DriveUser>
  readonly parents?: ReadonlyArray<string>
  readonly permissions?: ReadonlyArray<DrivePermission>
  readonly shared?: boolean
  readonly trashed?: boolean
  readonly webViewLink?: string
  readonly webContentLink?: string
  readonly iconLink?: string
  readonly thumbnailLink?: string
  readonly driveId?: string
}

export type DriveFileList = {
  readonly files: ReadonlyArray<DriveFile>
  readonly nextPageToken?: string
  readonly incompleteSearch?: boolean
}

export type DriveAbout = {
  readonly storageQuota: {
    readonly limit?: string
    readonly usage: string
    readonly usageInDrive: string
    readonly usageInDriveTrash: string
  }
  readonly user: DriveUser
}

export type DriveSharedDrive = {
  readonly id: string
  readonly name: string
  readonly createdTime?: string
}

export type DriveSharedDriveList = {
  readonly drives: ReadonlyArray<DriveSharedDrive>
  readonly nextPageToken?: string
}

export type ListFilesOptions = {
  readonly folderId?: string
  readonly query?: string
  readonly pageSize?: number
  readonly pageToken?: string
  readonly orderBy?: string
  readonly driveId?: string
  readonly trashed?: boolean
  readonly sharedWithMe?: boolean
}

export type UploadOptions = {
  readonly name: string
  readonly parentId?: string
  readonly mimeType: string
  readonly driveId?: string
}

// fields we always request from the API
export const DRIVE_FILE_FIELDS =
  "id,name,mimeType,size,createdTime,modifiedTime,owners," +
  "parents,permissions,shared,trashed,webViewLink," +
  "webContentLink,iconLink,thumbnailLink,driveId"

export const DRIVE_LIST_FIELDS =
  `nextPageToken,files(${DRIVE_FILE_FIELDS})`
