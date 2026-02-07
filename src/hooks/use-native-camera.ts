"use client"

import { useCallback } from "react"
import { useNative } from "./use-native"

export type CapturedPhoto = Readonly<{
  uri: string
  webPath: string
  format: string
  exifData: Readonly<{
    lat: number | undefined
    lng: number | undefined
    timestamp: string | undefined
  }>
}>

export function useNativeCamera() {
  const native = useNative()

  const takePhoto = useCallback(async (): Promise<
    CapturedPhoto | null
  > => {
    if (!native) return null

    try {
      const { Camera, CameraResultType, CameraSource } =
        await import("@capacitor/camera")

      const photo = await Camera.getPhoto({
        quality: 85,
        width: 2048,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
        direction: undefined, // defaults to rear
        saveToGallery: true,
        correctOrientation: true,
      })

      return {
        uri: photo.path ?? photo.webPath ?? "",
        webPath: photo.webPath ?? "",
        format: photo.format,
        exifData: {
          lat: photo.exif?.["GPSLatitude"] as
            | number
            | undefined,
          lng: photo.exif?.["GPSLongitude"] as
            | number
            | undefined,
          timestamp: photo.exif?.["DateTimeOriginal"] as
            | string
            | undefined,
        },
      }
    } catch (err) {
      // user cancelled or camera error
      if (
        err instanceof Error &&
        err.message.includes("cancelled")
      ) {
        return null
      }
      console.error("Camera error:", err)
      return null
    }
  }, [native])

  return { takePhoto, isNative: native }
}
