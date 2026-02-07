"use client"

import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react"
import { useNative } from "./use-native"
import { useNativeCamera } from "./use-native-camera"
import type { CapturedPhoto } from "./use-native-camera"
import {
  addToQueue,
  getQueuedPhotos,
  getPendingCount,
  processQueue,
  retryAllFailed as retryAllFailedQueue,
  savePhotoToDevice,
} from "@/lib/native/photo-queue"
import { nanoid } from "nanoid"

type QueueStatus = "idle" | "uploading" | "done" | "error"

export function usePhotoQueue(uploadUrl: string) {
  const native = useNative()
  const { takePhoto } = useNativeCamera()
  const [pendingCount, setPendingCount] = useState(0)
  const [uploadStatus, setUploadStatus] =
    useState<QueueStatus>("idle")
  const networkListenerRef = useRef<
    (() => void) | undefined
  >(undefined)

  const refresh = useCallback(async () => {
    if (!native) return
    const count = await getPendingCount()
    setPendingCount(count)
  }, [native])

  // poll queue count and listen for network changes
  useEffect(() => {
    if (!native) return

    refresh()

    let cleanup: (() => void) | undefined

    async function setupNetworkListener() {
      const { Network } = await import(
        "@capacitor/network"
      )
      const listener = await Network.addListener(
        "networkStatusChange",
        async (status) => {
          if (status.connected) {
            setUploadStatus("uploading")
            try {
              await processQueue(uploadUrl)
              setUploadStatus("done")
            } catch {
              setUploadStatus("error")
            }
            await refresh()
          }
        },
      )
      cleanup = () => listener.remove()
    }

    setupNetworkListener()
    networkListenerRef.current = cleanup

    return () => cleanup?.()
  }, [native, uploadUrl, refresh])

  const takeAndQueuePhoto = useCallback(
    async (
      projectId: string,
    ): Promise<CapturedPhoto | null> => {
      const photo = await takePhoto()
      if (!photo) return null

      const id = nanoid()
      const fileName = `${id}.${photo.format}`

      const localPath = await savePhotoToDevice(
        photo.uri,
        fileName,
      )

      await addToQueue({
        id,
        projectId,
        localPath,
        fileName,
        lat: photo.exifData.lat,
        lng: photo.exifData.lng,
        capturedAt: new Date().toISOString(),
      })

      await refresh()

      return photo
    },
    [takePhoto, refresh],
  )

  const retryFailed = useCallback(async () => {
    await retryAllFailedQueue()
    setUploadStatus("uploading")
    try {
      await processQueue(uploadUrl)
      setUploadStatus("done")
    } catch {
      setUploadStatus("error")
    }
    await refresh()
  }, [uploadUrl, refresh])

  const getPhotos = useCallback(async () => {
    if (!native) return []
    return getQueuedPhotos()
  }, [native])

  return {
    takeAndQueuePhoto,
    pendingCount,
    uploadStatus,
    retryFailed,
    getPhotos,
    refresh,
  }
}
