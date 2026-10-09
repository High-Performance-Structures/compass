"use client"

import * as React from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { TalkImageEditor } from "@/components/voice/talk-image-editor"
import {
  TALK_BACKGROUNDS,
  removeTalkImage,
  type TalkPreferences
} from "@/lib/realtimekit/talk-preferences"

const SYSTEM_DEFAULT_DEVICE = "__system_default__"

export type TalkDeviceKind = "cameraId" | "microphoneId" | "speakerId"

const BLUR_COMMIT_DELAY_MS = 400

/**
 * Each committed strength rebuilds the camera's background pipeline, so the
 * slider tracks its value locally and commits once per adjustment: on pointer
 * release or blur, or once dragging or keyboard steps pause.
 */
function BlurStrengthSlider({
  strength,
  onCommit
}: {
  readonly strength: number
  readonly onCommit: (strength: number) => void
}): React.ReactElement {
  const [draft, setDraft] = React.useState(strength)
  const onCommitRef = React.useRef(onCommit)
  onCommitRef.current = onCommit

  React.useEffect(() => {
    setDraft(strength)
  }, [strength])

  React.useEffect(() => {
    if (draft === strength) return
    const timer = window.setTimeout(
      () => onCommitRef.current(draft),
      BLUR_COMMIT_DELAY_MS
    )
    return () => window.clearTimeout(timer)
  }, [draft, strength])

  const commitNow = (): void => {
    if (draft !== strength) onCommitRef.current(draft)
  }

  return (
    <label className="grid gap-2 text-sm">
      Blur strength: {draft}%
      <input
        type="range"
        min={10}
        max={100}
        step={5}
        value={draft}
        onPointerUp={commitNow}
        onPointerCancel={commitNow}
        onBlur={commitNow}
        onChange={(event) => setDraft(event.currentTarget.valueAsNumber)}
      />
    </label>
  )
}

export function TalkSettingsPanel({
  preferences,
  onChange,
  devices,
  onDeviceChange,
  onRefreshDevices,
  busy,
  status
}: {
  readonly preferences: TalkPreferences
  readonly onChange: (preferences: TalkPreferences) => void
  readonly devices: readonly MediaDeviceInfo[]
  readonly onDeviceChange: (kind: TalkDeviceKind, id: string) => void
  readonly onRefreshDevices: () => void
  readonly busy: boolean
  readonly status: string | null
}): React.ReactElement {
  const uploadRef = React.useRef<HTMLInputElement | null>(null)
  const [upload, setUpload] = React.useState<File | null>(null)
  const [removeId, setRemoveId] = React.useState<string | null>(null)
  const images = [...TALK_BACKGROUNDS, ...preferences.images]
  return (
    <div className="space-y-5 text-foreground">
      <fieldset disabled={busy} className="space-y-3 disabled:opacity-60">
        <legend className="mb-2 text-sm font-semibold">Background</legend>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={
              preferences.background.mode === "none" ? "default" : "outline"
            }
            aria-pressed={preferences.background.mode === "none"}
            onClick={() =>
              onChange({ ...preferences, background: { mode: "none" } })
            }
          >
            Off
          </Button>
          <Button
            type="button"
            variant={
              preferences.background.mode === "blur" ? "default" : "outline"
            }
            aria-pressed={preferences.background.mode === "blur"}
            onClick={() =>
              onChange({
                ...preferences,
                background: { mode: "blur", strength: 45 }
              })
            }
          >
            Blur
          </Button>
        </div>
        {preferences.background.mode === "blur" ? (
          <BlurStrengthSlider
            strength={preferences.background.strength}
            onCommit={(strength) =>
              onChange({
                ...preferences,
                background: { mode: "blur", strength }
              })
            }
          />
        ) : null}
        {preferences.background.mode !== "none" ? (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={preferences.backgroundCleanup === "strong"}
                onChange={(event) =>
                  onChange({
                    ...preferences,
                    backgroundCleanup: event.currentTarget.checked
                      ? "strong"
                      : "standard"
                  })
                }
              />
              Stronger background cleanup
            </label>
            <p className="text-xs text-muted-foreground">
              Hides more uncertain background edges. May trim fine hair or
              fingertips. Most effective in Chrome, Edge, and Firefox.
            </p>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image) => (
            <div key={image.id} className="min-w-0">
              <button
                type="button"
                aria-pressed={
                  preferences.background.mode === "image" &&
                  preferences.background.imageId === image.id
                }
                onClick={() =>
                  onChange({
                    ...preferences,
                    background: { mode: "image", imageId: image.id }
                  })
                }
                className="w-full overflow-hidden rounded-lg border text-left aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary focus-visible:outline-2 focus-visible:outline-ring"
              >
                {/* Local data URLs and static SVG assets do not need the image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt=""
                  className="aspect-video w-full object-cover"
                />
                <span className="block truncate px-2 py-1 text-xs">
                  {image.name}
                </span>
              </button>
              {preferences.images.some((custom) => custom.id === image.id) ? (
                <button
                  type="button"
                  className="mt-1 text-xs text-destructive underline"
                  onClick={() => setRemoveId(image.id)}
                >
                  Remove {image.name}
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={preferences.images.length >= 6}
          onClick={() => uploadRef.current?.click()}
        >
          Upload a background ({preferences.images.length}/6)
        </Button>
        <input
          ref={uploadRef}
          type="file"
          aria-label="Upload a background file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            setUpload(event.currentTarget.files?.[0] ?? null)
            event.currentTarget.value = ""
          }}
        />
        <p className="text-xs text-muted-foreground">
          Personal images and preferences are saved only in this browser for
          your Compass account. JPEG, PNG, or WebP, up to 8 MB.
        </p>
      </fieldset>
      {removeId ? (
        <div role="alert" className="space-y-2 border-y py-3">
          <p className="text-sm">
            Remove this personal background? If it is selected, your background
            will switch to Off.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                onChange(removeTalkImage(preferences, removeId))
                setRemoveId(null)
              }}
            >
              Remove background
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRemoveId(null)}
            >
              Keep it
            </Button>
          </div>
        </div>
      ) : null}
      {upload ? (
        <TalkImageEditor
          key={upload.name + upload.lastModified}
          file={upload}
          onCancel={() => setUpload(null)}
          onSave={(image) => {
            onChange({
              ...preferences,
              images: [...preferences.images, image],
              background: { mode: "image", imageId: image.id }
            })
            setUpload(null)
          }}
        />
      ) : null}
      <fieldset
        disabled={busy}
        className="grid gap-3 border-t pt-4 disabled:opacity-60"
      >
        <legend className="text-sm font-semibold">Camera & audio</legend>
        {(
          [
            ["cameraId", "videoinput", "Camera"],
            ["microphoneId", "audioinput", "Microphone"],
            ["speakerId", "audiooutput", "Speakers"]
          ] satisfies readonly (readonly [
            TalkDeviceKind,
            MediaDeviceKind,
            string
          ])[]
        ).map(([key, kind, label]) => (
          <label key={key} className="grid gap-1 text-sm">
            {label}
            <Select
              // Select items cannot use "", so the system default gets a
              // sentinel that maps back to "" for the saved preference.
              value={
                devices.some(
                  (device) =>
                    device.kind === kind && device.deviceId === preferences[key]
                )
                  ? preferences[key]
                  : SYSTEM_DEFAULT_DEVICE
              }
              onValueChange={(value) =>
                onDeviceChange(key, value === SYSTEM_DEFAULT_DEVICE ? "" : value)
              }
            >
              <SelectTrigger aria-label={label} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SYSTEM_DEFAULT_DEVICE}>System default</SelectItem>
                {devices
                  .filter((device) => device.kind === kind && device.deviceId)
                  .map((device, index) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `${label} ${index + 1}`}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </label>
        ))}
        {!devices.some((device) => device.kind === "audioinput" && device.label) ? (
          <p className="text-xs text-muted-foreground">
            Microphone names may be hidden until browser access is allowed. Use
            the microphone control to request access, then refresh devices.
          </p>
        ) : null}
        <Button type="button" variant="outline" onClick={onRefreshDevices}>
          Refresh devices
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={preferences.joinWithCamera}
            onChange={(event) =>
              onChange({
                ...preferences,
                joinWithCamera: event.currentTarget.checked
              })
            }
          />
          Join with camera on
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={preferences.joinWithMicrophone}
            onChange={(event) =>
              onChange({
                ...preferences,
                joinWithMicrophone: event.currentTarget.checked
              })
            }
          />
          Join with microphone on
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={preferences.mutedSpeechHint}
            onChange={(event) =>
              onChange({
                ...preferences,
                mutedSpeechHint: event.currentTarget.checked
              })
            }
          />
          <span>
            Tell me when I&rsquo;m talking while muted
            <span className="block text-xs text-muted-foreground">
              Keeps your microphone open in this browser while you are muted so
              Compass can notice speech. Nothing is sent to the meeting, but
              your browser will show the microphone as in use.
            </span>
          </span>
        </label>
      </fieldset>
      {status ? (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      ) : null}
    </div>
  )
}
