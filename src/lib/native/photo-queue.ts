// Offline photo queue manager.
// Saves photos to device filesystem, tracks metadata in Preferences,
// auto-uploads when connectivity returns via background-capable uploader.

type QueuedPhotoMeta = {
  readonly id: string
  readonly projectId: string
  readonly localPath: string
  readonly fileName: string
  readonly lat: number | undefined
  readonly lng: number | undefined
  readonly capturedAt: string
  status: "pending" | "uploading" | "uploaded" | "failed"
  retryCount: number
  uploadedUrl?: string
}

type PhotoQueue = {
  items: QueuedPhotoMeta[]
}

const QUEUE_KEY = "compass_photo_queue"
const MAX_RETRIES = 3

async function loadQueue(): Promise<PhotoQueue> {
  const { Preferences } = await import(
    "@capacitor/preferences"
  )
  const result = await Preferences.get({ key: QUEUE_KEY })
  if (!result.value) return { items: [] }
  try {
    return JSON.parse(result.value) as PhotoQueue
  } catch {
    return { items: [] }
  }
}

async function saveQueue(queue: PhotoQueue): Promise<void> {
  const { Preferences } = await import(
    "@capacitor/preferences"
  )
  await Preferences.set({
    key: QUEUE_KEY,
    value: JSON.stringify(queue),
  })
}

export async function addToQueue(
  photo: Omit<QueuedPhotoMeta, "status" | "retryCount">,
): Promise<void> {
  const queue = await loadQueue()
  queue.items.push({
    ...photo,
    status: "pending",
    retryCount: 0,
  })
  await saveQueue(queue)
}

export async function getQueuedPhotos(): Promise<
  ReadonlyArray<QueuedPhotoMeta>
> {
  const queue = await loadQueue()
  return queue.items
}

export async function getPendingCount(): Promise<number> {
  const queue = await loadQueue()
  return queue.items.filter(
    (p) =>
      p.status === "pending" || p.status === "uploading",
  ).length
}

export async function processQueue(
  uploadUrl: string,
): Promise<{ uploaded: number; failed: number }> {
  const queue = await loadQueue()
  let uploaded = 0
  let failed = 0

  const pending = queue.items.filter(
    (p) => p.status === "pending" || p.status === "failed",
  )

  for (const photo of pending) {
    if (
      photo.status === "failed" &&
      photo.retryCount >= MAX_RETRIES
    ) {
      continue
    }

    photo.status = "uploading"
    await saveQueue(queue)

    try {
      const { Uploader } = await import(
        "@capgo/capacitor-uploader"
      )

      const result = await Uploader.startUpload({
        filePath: photo.localPath,
        serverUrl: uploadUrl,
        method: "POST",
        headers: {
          "X-Project-Id": photo.projectId,
          "X-Photo-Id": photo.id,
          "X-Captured-At": photo.capturedAt,
          ...(photo.lat !== undefined && {
            "X-GPS-Lat": String(photo.lat),
          }),
          ...(photo.lng !== undefined && {
            "X-GPS-Lng": String(photo.lng),
          }),
        },
      })

      if (result.id) {
        photo.status = "uploaded"
        uploaded++
      } else {
        throw new Error("Upload returned no id")
      }
    } catch (err) {
      console.error(`Upload failed for ${photo.id}:`, err)
      photo.status = "failed"
      photo.retryCount++
      failed++
    }

    await saveQueue(queue)
  }

  // clean up uploaded photos from filesystem
  const { Filesystem, Directory } = await import(
    "@capacitor/filesystem"
  )
  const uploadedItems = queue.items.filter(
    (p) => p.status === "uploaded",
  )
  for (const item of uploadedItems) {
    try {
      await Filesystem.deleteFile({
        path: item.localPath,
        directory: Directory.Data,
      })
    } catch {
      // file already cleaned up
    }
  }

  // remove uploaded items from queue
  queue.items = queue.items.filter(
    (p) => p.status !== "uploaded",
  )
  await saveQueue(queue)

  return { uploaded, failed }
}

export async function retryAllFailed(): Promise<void> {
  const queue = await loadQueue()
  for (const item of queue.items) {
    if (item.status === "failed") {
      item.status = "pending"
      item.retryCount = 0
    }
  }
  await saveQueue(queue)
}

export async function savePhotoToDevice(
  sourceUri: string,
  fileName: string,
): Promise<string> {
  const { Filesystem, Directory } = await import(
    "@capacitor/filesystem"
  )

  // copy photo to app's data directory for persistence
  const result = await Filesystem.copy({
    from: sourceUri,
    to: `compass-photos/${fileName}`,
    toDirectory: Directory.Data,
  })

  return result.uri
}
