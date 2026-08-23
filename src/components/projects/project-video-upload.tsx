"use client"

import * as React from "react"
import { IconUpload, IconVideo, IconX } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { YoutubeLogo } from "@/components/brand/youtube-logo"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { projectDepartment } from "@/lib/project-branding"
import { youtubeChannelForDepartment } from "@/lib/videos/channel-routing"
import {
  isProjectVideoFile,
  MAX_PROJECT_VIDEO_UPLOAD_BYTES,
  PROJECT_VIDEO_UPLOAD_LIMIT_LABEL,
} from "@/lib/videos/upload-limits"
import {
  shouldAttemptBrowserUploadRecovery,
  VIDEO_UPLOAD_COMPLETION_RETRY_DELAYS_MS,
} from "@/lib/videos/upload-recovery"

type UploadStage = "idle" | "starting" | "uploading" | "saving"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json()
  return isRecord(value) ? value : {}
}

function responseError(
  body: Readonly<Record<string, unknown>>,
  fallback: string
): string {
  return typeof body.error === "string" && body.error.trim().length > 0
    ? body.error
    : fallback
}

function titleFromFileName(fileName: string): string {
  const title = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim()
  return title.slice(0, 100) || "Project video"
}

function channelLabel(channelKey: string): string {
  if (channelKey === "hps") return "High Performance Structures"
  if (channelKey === "nutech") return "Nu-Tech Systems"
  return "Open Range Construction"
}

function uploadToGoogleDrive(input: {
  readonly uploadUrl: string
  readonly file: File
  readonly mimeType: string
  readonly onProgress: (value: number) => void
  readonly onRequest: (request: XMLHttpRequest | null) => void
}): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    let uploadedBytes = 0
    input.onRequest(request)
    request.open("PUT", input.uploadUrl)
    request.setRequestHeader("Content-Type", input.mimeType)
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return
      uploadedBytes = event.loaded
      input.onProgress(Math.round((event.loaded / event.total) * 100))
    })
    request.addEventListener("load", () => {
      input.onRequest(null)
      if (request.status !== 200 && request.status !== 201) {
        reject(new Error(`Google Drive upload failed (${request.status}).`))
        return
      }
      let body: unknown = null
      try {
        body = JSON.parse(request.responseText)
      } catch {
        reject(new Error("Google Drive did not return the uploaded video."))
        return
      }
      if (!isRecord(body) || typeof body.id !== "string" || !body.id) {
        reject(new Error("Google Drive did not return the uploaded video."))
        return
      }
      input.onProgress(100)
      resolve(body.id)
    })
    request.addEventListener("error", () => {
      input.onRequest(null)
      if (
        shouldAttemptBrowserUploadRecovery({
          uploadedBytes,
          fileSize: input.file.size,
        })
      ) {
        input.onProgress(100)
        resolve(null)
        return
      }
      reject(new Error("The video upload was interrupted. Please try again."))
    })
    request.addEventListener("abort", () => {
      input.onRequest(null)
      reject(new Error("Video upload cancelled."))
    })
    request.send(input.file)
  })
}

async function wait(value: number): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, value)
  })
}

export function ProjectVideoUpload({
  projectId,
  projectNumber,
}: {
  readonly projectId: string
  readonly projectNumber: string | null
}): React.ReactElement {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const requestRef = React.useRef<XMLHttpRequest | null>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [audience, setAudience] = React.useState("staff")
  const [youtubePrivacy, setYoutubePrivacy] = React.useState("private")
  const [addToDailyLog, setAddToDailyLog] = React.useState(true)
  const [stage, setStage] = React.useState<UploadStage>("idle")
  const [progress, setProgress] = React.useState(0)
  const department = projectDepartment({ projectId, projectNumber })
  const channelKey = youtubeChannelForDepartment(department)
  const busy = stage !== "idle"

  function reset(): void {
    setFile(null)
    setTitle("")
    setDescription("")
    setAudience("staff")
    setYoutubePrivacy("private")
    setAddToDailyLog(true)
    setStage("idle")
    setProgress(0)
    if (inputRef.current) inputRef.current.value = ""
  }

  function chooseFile(selected: File | null): void {
    if (!selected) return
    if (!isProjectVideoFile({ fileName: selected.name, mimeType: selected.type })) {
      toast.error("Choose a supported video file.")
      return
    }
    if (selected.size <= 0 || selected.size > MAX_PROJECT_VIDEO_UPLOAD_BYTES) {
      toast.error(`Videos may be up to ${PROJECT_VIDEO_UPLOAD_LIMIT_LABEL}.`)
      return
    }
    setFile(selected)
    setTitle(titleFromFileName(selected.name))
    setProgress(0)
  }

  async function upload(): Promise<void> {
    if (!file || busy) return
    const normalizedTitle = title.trim()
    if (!normalizedTitle || normalizedTitle.length > 100) {
      toast.error("Video title must be 1 to 100 characters.")
      return
    }
    try {
      setStage("starting")
      setProgress(0)
      const startResponse = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/videos/upload/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type,
            fileSize: file.size,
          }),
        }
      )
      const startBody = await responseBody(startResponse)
      if (
        !startResponse.ok ||
        startBody.success !== true ||
        typeof startBody.uploadUrl !== "string" ||
        typeof startBody.uploadToken !== "string" ||
        typeof startBody.mimeType !== "string"
      ) {
        throw new Error(
          responseError(startBody, "Compass could not start the video upload.")
        )
      }

      setStage("uploading")
      const driveFileId = await uploadToGoogleDrive({
        uploadUrl: startBody.uploadUrl,
        file,
        mimeType: startBody.mimeType,
        onProgress: setProgress,
        onRequest: (request) => {
          requestRef.current = request
        },
      })

      setStage("saving")
      let saved = false
      let completionError = "Compass could not save the uploaded video."
      for (
        let attempt = 0;
        attempt <= VIDEO_UPLOAD_COMPLETION_RETRY_DELAYS_MS.length;
        attempt += 1
      ) {
        const completeResponse = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/videos/upload/complete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              driveFileId,
              uploadToken: startBody.uploadToken,
              title: normalizedTitle,
              description: description.trim(),
              compassAudience: audience,
              youtubePrivacy,
              addToDailyLog,
            }),
          }
        )
        const completeBody = await responseBody(completeResponse)
        if (completeResponse.ok && completeBody.success === true) {
          saved = true
          break
        }
        completionError = responseError(
          completeBody,
          "Compass could not save the uploaded video."
        )
        const retryDelay = VIDEO_UPLOAD_COMPLETION_RETRY_DELAYS_MS[attempt]
        if (completeResponse.status !== 409 || retryDelay === undefined) break
        await wait(retryDelay)
      }
      if (!saved) {
        throw new Error(
          driveFileId === null && completionError.includes("still finishing")
            ? "The video upload was interrupted. Please try again."
            : completionError
        )
      }
      toast.success("Video uploaded. Review and publish it below.")
      reset()
      router.refresh()
    } catch (error) {
      setStage("idle")
      toast.error(
        error instanceof Error ? error.message : "Compass could not upload the video."
      )
    }
  }

  return (
    <section className="border-border border-b py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <IconUpload className="size-4" /> Upload from this device
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Large videos upload directly to the project’s Google Drive folder,
            then enter the same review and YouTube publishing workflow.
          </p>
        </div>
        {!file && (
          <Button
            type="button"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            <IconVideo /> Choose video
          </Button>
        )}
        <Input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="video/*,.3g2,.3gp,.avi,.flv,.m4v,.mkv,.mov,.mp4,.mpeg,.mpg,.webm,.wmv"
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
        />
      </div>

      {file && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="website-youtube-privacy">YouTube privacy</Label>
              <Select
                value={youtubePrivacy}
                disabled={busy}
                onValueChange={setYoutubePrivacy}
              >
                <SelectTrigger id="website-youtube-privacy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="unlisted">Unlisted</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                This exact privacy status will be sent to YouTube after review.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="website-video-title">Video title</Label>
              <Input
                id="website-video-title"
                value={title}
                maxLength={100}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website-video-description">Description</Label>
              <Textarea
                id="website-video-description"
                value={description}
                maxLength={5000}
                rows={3}
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Who may receive the link?</Label>
              <Select value={audience} disabled={busy} onValueChange={setAudience}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff only</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="sub_vendor">Subs / suppliers</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Destination:</span>
              <a
                href="https://www.youtube.com/"
                target="_blank"
                rel="noreferrer"
                aria-label="Open YouTube"
              >
                <YoutubeLogo />
              </a>
              <span>{channelLabel(channelKey)}</span>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={addToDailyLog}
                disabled={busy}
                onCheckedChange={(checked) => setAddToDailyLog(checked === true)}
              />
              <span>Add a review entry to today’s Daily Log.</span>
            </label>
          </div>

          {busy && (
            <div className="lg:col-span-2">
              <div className="mb-2 flex justify-between text-sm">
                <span>
                  {stage === "starting"
                    ? "Preparing upload…"
                    : stage === "saving"
                      ? "Saving in Compass…"
                      : "Uploading to Google Drive…"}
                </span>
                <span>{stage === "uploading" ? `${progress}%` : ""}</span>
              </div>
              <Progress value={stage === "uploading" ? progress : undefined} />
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-3 lg:col-span-2">
            <p className="text-muted-foreground text-xs">
              {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={stage === "starting" || stage === "saving"}
                onClick={() => {
                  if (stage === "uploading") requestRef.current?.abort()
                  else reset()
                }}
              >
                <IconX /> {stage === "uploading" ? "Cancel upload" : "Remove"}
              </Button>
              <Button type="button" disabled={busy} onClick={() => void upload()}>
                <IconUpload /> Upload for review
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
