"use client"

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react"
import {
  mockFiles,
  mockStorageUsage,
  type FileItem,
  type StorageUsage,
} from "@/lib/files-data"
import {
  getGoogleDriveConnectionStatus,
  listDriveFiles,
  listDriveFilesForView,
  searchDriveFiles,
  createDriveFolder,
  renameDriveFile,
  moveDriveFile,
  trashDriveFile,
  restoreDriveFile,
  toggleStarFile,
  getDriveStorageQuota,
  getUploadSessionUrl,
  listDriveFolders,
} from "@/app/actions/google-drive"

export type FileView =
  | "my-files"
  | "shared"
  | "recent"
  | "starred"
  | "trash"

export type SortField = "name" | "modified" | "size" | "type"
export type SortDirection = "asc" | "desc"
export type ViewMode = "grid" | "list"

type FilesState = {
  viewMode: ViewMode
  currentView: FileView
  selectedIds: Set<string>
  sortBy: SortField
  sortDirection: SortDirection
  searchQuery: string
  files: FileItem[]
  isConnected: boolean | null
  isLoading: boolean
  error: string | null
  storageQuota: StorageUsage
  nextPageToken: string | null
}

type FilesAction =
  | { type: "SET_VIEW_MODE"; payload: ViewMode }
  | { type: "SET_CURRENT_VIEW"; payload: FileView }
  | { type: "SET_SELECTED"; payload: Set<string> }
  | { type: "TOGGLE_SELECTED"; payload: string }
  | { type: "CLEAR_SELECTION" }
  | {
      type: "SET_SORT"
      payload: { field: SortField; direction: SortDirection }
    }
  | { type: "SET_SEARCH"; payload: string }
  | { type: "SET_FILES"; payload: FileItem[] }
  | { type: "APPEND_FILES"; payload: FileItem[] }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_CONNECTED"; payload: boolean }
  | { type: "SET_STORAGE_QUOTA"; payload: StorageUsage }
  | { type: "SET_NEXT_PAGE_TOKEN"; payload: string | null }
  | { type: "OPTIMISTIC_STAR"; payload: string }
  | { type: "OPTIMISTIC_TRASH"; payload: string }
  | { type: "OPTIMISTIC_RESTORE"; payload: string }
  | {
      type: "OPTIMISTIC_RENAME"
      payload: { id: string; name: string }
    }
  | { type: "OPTIMISTIC_ADD_FOLDER"; payload: FileItem }
  | { type: "REMOVE_FILE"; payload: string }

function filesReducer(
  state: FilesState,
  action: FilesAction
): FilesState {
  switch (action.type) {
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.payload }
    case "SET_CURRENT_VIEW":
      return {
        ...state,
        currentView: action.payload,
        selectedIds: new Set(),
      }
    case "SET_SELECTED":
      return { ...state, selectedIds: action.payload }
    case "TOGGLE_SELECTED": {
      const next = new Set(state.selectedIds)
      if (next.has(action.payload)) next.delete(action.payload)
      else next.add(action.payload)
      return { ...state, selectedIds: next }
    }
    case "CLEAR_SELECTION":
      return { ...state, selectedIds: new Set() }
    case "SET_SORT":
      return {
        ...state,
        sortBy: action.payload.field,
        sortDirection: action.payload.direction,
      }
    case "SET_SEARCH":
      return {
        ...state,
        searchQuery: action.payload,
        selectedIds: new Set(),
      }
    case "SET_FILES":
      return { ...state, files: action.payload }
    case "APPEND_FILES":
      return {
        ...state,
        files: [...state.files, ...action.payload],
      }
    case "SET_LOADING":
      return { ...state, isLoading: action.payload }
    case "SET_ERROR":
      return { ...state, error: action.payload }
    case "SET_CONNECTED":
      return { ...state, isConnected: action.payload }
    case "SET_STORAGE_QUOTA":
      return { ...state, storageQuota: action.payload }
    case "SET_NEXT_PAGE_TOKEN":
      return { ...state, nextPageToken: action.payload }
    case "OPTIMISTIC_STAR":
      return {
        ...state,
        files: state.files.map(f =>
          f.id === action.payload
            ? { ...f, starred: !f.starred }
            : f
        ),
      }
    case "OPTIMISTIC_TRASH":
      return {
        ...state,
        files: state.files.filter(
          f => f.id !== action.payload
        ),
        selectedIds: new Set(),
      }
    case "OPTIMISTIC_RESTORE":
      return {
        ...state,
        files: state.files.filter(
          f => f.id !== action.payload
        ),
      }
    case "OPTIMISTIC_RENAME":
      return {
        ...state,
        files: state.files.map(f =>
          f.id === action.payload.id
            ? {
                ...f,
                name: action.payload.name,
                modifiedAt: new Date().toISOString(),
              }
            : f
        ),
      }
    case "OPTIMISTIC_ADD_FOLDER":
      return {
        ...state,
        files: [action.payload, ...state.files],
      }
    case "REMOVE_FILE":
      return {
        ...state,
        files: state.files.filter(
          f => f.id !== action.payload
        ),
      }
    default:
      return state
  }
}

const initialState: FilesState = {
  viewMode: "grid",
  currentView: "my-files",
  selectedIds: new Set(),
  sortBy: "name",
  sortDirection: "asc",
  searchQuery: "",
  files: [],
  isConnected: null,
  isLoading: true,
  error: null,
  storageQuota: mockStorageUsage,
  nextPageToken: null,
}

type FilesContextValue = {
  state: FilesState
  dispatch: React.Dispatch<FilesAction>
  // fetching
  fetchFiles: (
    folderId?: string,
    view?: FileView
  ) => Promise<void>
  loadMore: () => Promise<void>
  // mutations
  createFolder: (
    name: string,
    parentId?: string
  ) => Promise<boolean>
  renameFile: (
    fileId: string,
    newName: string
  ) => Promise<boolean>
  moveFile: (
    fileId: string,
    newParentId: string,
    oldParentId: string
  ) => Promise<boolean>
  trashFile: (fileId: string) => Promise<boolean>
  restoreFile: (fileId: string) => Promise<boolean>
  starFile: (fileId: string) => Promise<boolean>
  getUploadUrl: (
    fileName: string,
    mimeType: string,
    parentId?: string
  ) => Promise<string | null>
  fetchFolders: (
    parentId?: string
  ) => Promise<
    ReadonlyArray<{ id: string; name: string }> | null
  >
  // backward compat for mock data mode
  getFilesForPath: (path: string[]) => FileItem[]
  getFilesForView: (view: FileView, path: string[]) => FileItem[]
  storageUsage: StorageUsage
  getFolders: () => FileItem[]
}

const FilesContext = createContext<FilesContextValue | null>(null)

export function FilesProvider({
  children,
}: {
  children: ReactNode
}) {
  const [state, dispatch] = useReducer(filesReducer, initialState)
  const currentFolderRef = useRef<string | undefined>(undefined)
  const currentViewRef = useRef<FileView>("my-files")

  // check connection on mount
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const status =
          await getGoogleDriveConnectionStatus()
        if (cancelled) return
        dispatch({
          type: "SET_CONNECTED",
          payload: status.connected,
        })

        if (!status.connected) {
          // fall back to mock data
          dispatch({ type: "SET_FILES", payload: mockFiles })
          dispatch({ type: "SET_LOADING", payload: false })
        }
      } catch {
        if (cancelled) return
        dispatch({ type: "SET_CONNECTED", payload: false })
        dispatch({ type: "SET_FILES", payload: mockFiles })
        dispatch({ type: "SET_LOADING", payload: false })
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  // fetch storage quota when connected
  useEffect(() => {
    if (state.isConnected !== true) return
    let cancelled = false
    async function fetchQuota() {
      const result = await getDriveStorageQuota()
      if (cancelled) return
      if (result.success) {
        dispatch({
          type: "SET_STORAGE_QUOTA",
          payload: {
            used: result.used,
            total: result.total,
          },
        })
      }
    }
    fetchQuota()
    return () => {
      cancelled = true
    }
  }, [state.isConnected])

  const fetchFiles = useCallback(
    async (folderId?: string, view?: FileView) => {
      if (state.isConnected !== true) return

      currentFolderRef.current = folderId
      currentViewRef.current = view ?? "my-files"
      dispatch({ type: "SET_LOADING", payload: true })
      dispatch({ type: "SET_ERROR", payload: null })

      try {
        let result

        if (view && view !== "my-files") {
          result = await listDriveFilesForView(view)
        } else if (state.searchQuery) {
          const searchResult = await searchDriveFiles(
            state.searchQuery
          )
          if (searchResult.success) {
            dispatch({
              type: "SET_FILES",
              payload: searchResult.files,
            })
            dispatch({
              type: "SET_NEXT_PAGE_TOKEN",
              payload: null,
            })
          } else {
            dispatch({
              type: "SET_ERROR",
              payload: searchResult.error,
            })
          }
          dispatch({ type: "SET_LOADING", payload: false })
          return
        } else {
          result = await listDriveFiles(folderId)
        }

        if (result.success) {
          dispatch({
            type: "SET_FILES",
            payload: sortFiles(
              result.files,
              state.sortBy,
              state.sortDirection
            ),
          })
          dispatch({
            type: "SET_NEXT_PAGE_TOKEN",
            payload: result.nextPageToken,
          })
        } else {
          dispatch({
            type: "SET_ERROR",
            payload: result.error,
          })
        }
      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          payload:
            err instanceof Error
              ? err.message
              : "Failed to load files",
        })
      } finally {
        dispatch({ type: "SET_LOADING", payload: false })
      }
    },
    [
      state.isConnected,
      state.searchQuery,
      state.sortBy,
      state.sortDirection,
    ]
  )

  const loadMore = useCallback(async () => {
    if (!state.nextPageToken || state.isConnected !== true)
      return

    dispatch({ type: "SET_LOADING", payload: true })
    try {
      const view = currentViewRef.current
      let result

      if (view !== "my-files") {
        result = await listDriveFilesForView(
          view,
          state.nextPageToken
        )
      } else {
        result = await listDriveFiles(
          currentFolderRef.current,
          state.nextPageToken
        )
      }

      if (result.success) {
        dispatch({ type: "APPEND_FILES", payload: result.files })
        dispatch({
          type: "SET_NEXT_PAGE_TOKEN",
          payload: result.nextPageToken,
        })
      }
    } finally {
      dispatch({ type: "SET_LOADING", payload: false })
    }
  }, [state.nextPageToken, state.isConnected])

  const createFolder = useCallback(
    async (
      name: string,
      parentId?: string
    ): Promise<boolean> => {
      if (state.isConnected !== true) return false

      const result = await createDriveFolder(name, parentId)
      if (result.success) {
        dispatch({
          type: "OPTIMISTIC_ADD_FOLDER",
          payload: result.folder,
        })
        return true
      }
      return false
    },
    [state.isConnected]
  )

  const renameFile = useCallback(
    async (
      fileId: string,
      newName: string
    ): Promise<boolean> => {
      if (state.isConnected !== true) return false

      dispatch({
        type: "OPTIMISTIC_RENAME",
        payload: { id: fileId, name: newName },
      })
      const result = await renameDriveFile(fileId, newName)
      if (!result.success) {
        // revert will happen on next fetch
        return false
      }
      return true
    },
    [state.isConnected]
  )

  const moveFile = useCallback(
    async (
      fileId: string,
      newParentId: string,
      oldParentId: string
    ): Promise<boolean> => {
      if (state.isConnected !== true) return false

      dispatch({ type: "REMOVE_FILE", payload: fileId })
      const result = await moveDriveFile(
        fileId,
        newParentId,
        oldParentId
      )
      if (!result.success) {
        // re-fetch to recover
        await fetchFiles(
          currentFolderRef.current,
          currentViewRef.current
        )
        return false
      }
      return true
    },
    [state.isConnected, fetchFiles]
  )

  const trashFile = useCallback(
    async (fileId: string): Promise<boolean> => {
      if (state.isConnected !== true) return false

      dispatch({ type: "OPTIMISTIC_TRASH", payload: fileId })
      const result = await trashDriveFile(fileId)
      if (!result.success) {
        await fetchFiles(
          currentFolderRef.current,
          currentViewRef.current
        )
        return false
      }
      return true
    },
    [state.isConnected, fetchFiles]
  )

  const restoreFile = useCallback(
    async (fileId: string): Promise<boolean> => {
      if (state.isConnected !== true) return false

      dispatch({
        type: "OPTIMISTIC_RESTORE",
        payload: fileId,
      })
      const result = await restoreDriveFile(fileId)
      if (!result.success) {
        await fetchFiles(
          currentFolderRef.current,
          currentViewRef.current
        )
        return false
      }
      return true
    },
    [state.isConnected, fetchFiles]
  )

  const starFile = useCallback(
    async (fileId: string): Promise<boolean> => {
      if (state.isConnected !== true) {
        // mock mode: just toggle locally
        dispatch({ type: "OPTIMISTIC_STAR", payload: fileId })
        return true
      }

      dispatch({ type: "OPTIMISTIC_STAR", payload: fileId })
      const result = await toggleStarFile(fileId)
      if (!result.success) {
        dispatch({ type: "OPTIMISTIC_STAR", payload: fileId })
        return false
      }
      return true
    },
    [state.isConnected]
  )

  const getUploadUrl = useCallback(
    async (
      fileName: string,
      mimeType: string,
      parentId?: string
    ): Promise<string | null> => {
      if (state.isConnected !== true) return null

      const result = await getUploadSessionUrl(
        fileName,
        mimeType,
        parentId
      )
      if (result.success) return result.uploadUrl
      return null
    },
    [state.isConnected]
  )

  const fetchFolders = useCallback(
    async (
      parentId?: string
    ): Promise<
      ReadonlyArray<{ id: string; name: string }> | null
    > => {
      if (state.isConnected !== true) return null

      const result = await listDriveFolders(parentId)
      if (result.success) return result.folders
      return null
    },
    [state.isConnected]
  )

  // backward compat: mock data selectors
  const getFilesForPath = useCallback(
    (path: string[]) => {
      if (state.isConnected === true) return state.files

      const allFiles =
        state.files.length > 0 ? state.files : mockFiles
      return allFiles.filter(f => {
        if (f.trashed) return false
        if (path.length === 0) return f.parentId === null
        const parentFolder = allFiles.find(
          folder =>
            folder.type === "folder" &&
            folder.name === path[path.length - 1] &&
            JSON.stringify(folder.path) ===
              JSON.stringify(path.slice(0, -1))
        )
        return parentFolder && f.parentId === parentFolder.id
      })
    },
    [state.files, state.isConnected]
  )

  const getFilesForView = useCallback(
    (view: FileView, path: string[]) => {
      // when connected, files are already fetched for
      // the right view
      if (state.isConnected === true) {
        let files = state.files

        if (state.searchQuery) {
          const q = state.searchQuery.toLowerCase()
          files = files.filter(f =>
            f.name.toLowerCase().includes(q)
          )
        }

        return sortFiles(
          files,
          state.sortBy,
          state.sortDirection
        )
      }

      // mock data mode
      const allFiles =
        state.files.length > 0 ? state.files : mockFiles
      let files: FileItem[]

      switch (view) {
        case "my-files":
          files = getFilesForPath(path)
          break
        case "shared":
          files = allFiles.filter(
            f => !f.trashed && f.shared
          )
          break
        case "recent": {
          const cutoff = new Date()
          cutoff.setDate(cutoff.getDate() - 30)
          files = allFiles
            .filter(
              f =>
                !f.trashed &&
                new Date(f.modifiedAt) > cutoff
            )
            .sort(
              (a, b) =>
                new Date(b.modifiedAt).getTime() -
                new Date(a.modifiedAt).getTime()
            )
          break
        }
        case "starred":
          files = allFiles.filter(
            f => !f.trashed && f.starred
          )
          break
        case "trash":
          files = allFiles.filter(f => f.trashed)
          break
        default:
          files = []
      }

      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase()
        files = files.filter(f =>
          f.name.toLowerCase().includes(q)
        )
      }

      return sortFiles(files, state.sortBy, state.sortDirection)
    },
    [
      state.files,
      state.searchQuery,
      state.sortBy,
      state.sortDirection,
      state.isConnected,
      getFilesForPath,
    ]
  )

  const getFolders = useCallback(() => {
    const allFiles =
      state.files.length > 0 ? state.files : mockFiles
    return allFiles.filter(
      f => f.type === "folder" && !f.trashed
    )
  }, [state.files])

  return (
    <FilesContext.Provider
      value={{
        state,
        dispatch,
        fetchFiles,
        loadMore,
        createFolder,
        renameFile,
        moveFile,
        trashFile,
        restoreFile,
        starFile,
        getUploadUrl,
        fetchFolders,
        getFilesForPath,
        getFilesForView,
        storageUsage: state.storageQuota,
        getFolders,
      }}
    >
      {children}
    </FilesContext.Provider>
  )
}

export function useFiles() {
  const ctx = useContext(FilesContext)
  if (!ctx)
    throw new Error(
      "useFiles must be used within FilesProvider"
    )
  return ctx
}

function sortFiles(
  files: FileItem[],
  sortBy: SortField,
  direction: SortDirection
): FileItem[] {
  const sorted = [...files].sort((a, b) => {
    if (a.type === "folder" && b.type !== "folder") return -1
    if (a.type !== "folder" && b.type === "folder") return 1

    let cmp = 0
    switch (sortBy) {
      case "name":
        cmp = a.name.localeCompare(b.name)
        break
      case "modified":
        cmp =
          new Date(a.modifiedAt).getTime() -
          new Date(b.modifiedAt).getTime()
        break
      case "size":
        cmp = a.size - b.size
        break
      case "type":
        cmp = a.type.localeCompare(b.type)
        break
    }
    return direction === "asc" ? cmp : -cmp
  })
  return sorted
}
