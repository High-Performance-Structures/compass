"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  talkImageCrop,
  type TalkImage
} from "@/lib/realtimekit/talk-preferences"

export function TalkImageEditor({
  file,
  onSave,
  onCancel
}: {
  readonly file: File
  readonly onSave: (image: TalkImage) => void
  readonly onCancel: () => void
}): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const [image, setImage] = React.useState<HTMLImageElement | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [zoom, setZoom] = React.useState(1)
  const [horizontal, setHorizontal] = React.useState(50)
  const [vertical, setVertical] = React.useState(50)

  React.useEffect(() => {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 8 * 1024 * 1024
    ) {
      setError("Choose a JPEG, PNG, or WebP image under 8 MB.")
      return
    }
    let current = true
    const url = URL.createObjectURL(file)
    const decoded = new Image()
    decoded.onload = () => {
      if (!current) return
      if (
        !decoded.naturalWidth ||
        !decoded.naturalHeight ||
        decoded.naturalWidth * decoded.naturalHeight > 32_000_000
      ) {
        setError("Choose an image smaller than 32 megapixels.")
        return
      }
      setImage(decoded)
    }
    decoded.onerror = () => {
      if (current) setError("This image could not be opened. Try another file.")
    }
    decoded.src = url
    return () => {
      current = false
      URL.revokeObjectURL(url)
    }
  }, [file])

  React.useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context || !image) return
    const crop = talkImageCrop(
      image.naturalWidth,
      image.naturalHeight,
      zoom,
      horizontal,
      vertical
    )
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      canvas.width,
      canvas.height
    )
  }, [image, zoom, horizontal, vertical])

  const save = (): void => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    let url = canvas.toDataURL("image/jpeg", 0.75)
    if (url.length > 400_000) url = canvas.toDataURL("image/jpeg", 0.45)
    if (url.length > 400_000) {
      setError("This image is too detailed to save. Try a simpler image.")
      return
    }
    onSave({
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "My background",
      url
    })
  }

  return (
    <section
      className="space-y-3 border-y py-4"
      aria-label="Crop your background"
    >
      <h3 className="text-sm font-semibold">Crop your background</h3>
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        className="aspect-video w-full rounded-lg bg-muted"
        aria-label="Cropped background preview"
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {image ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-xs">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(event) => setZoom(event.currentTarget.valueAsNumber)}
            />
          </label>
          <label className="grid gap-1 text-xs">
            Horizontal position
            <input
              type="range"
              min={0}
              max={100}
              value={horizontal}
              onChange={(event) =>
                setHorizontal(event.currentTarget.valueAsNumber)
              }
            />
          </label>
          <label className="grid gap-1 text-xs">
            Vertical position
            <input
              type="range"
              min={0}
              max={100}
              value={vertical}
              onChange={(event) =>
                setVertical(event.currentTarget.valueAsNumber)
              }
            />
          </label>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" disabled={!image || !!error} onClick={save}>
          Save background
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  )
}
