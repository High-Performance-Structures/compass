export type PictureInPictureVideoCandidate<T> = {
  readonly video: T
  readonly isSelfPreview: boolean
  readonly isReady: boolean
  readonly canUsePictureInPicture: boolean
}

type PictureInPictureTileRegistry = {
  readonly attach: (root: EventTarget) => () => void
  readonly getCandidates: (
    selfParticipantId: string
  ) => readonly PictureInPictureVideoCandidate<HTMLVideoElement>[]
}

type TileLoadDetail = {
  readonly participantId: string
  readonly videoElement: HTMLVideoElement
  readonly tileTarget: EventTarget | null
}

type PictureInPictureVideoRegistration = {
  readonly participantId: string
  readonly tileTarget: EventTarget | null
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isVideoElement(value: unknown): value is HTMLVideoElement {
  return (
    typeof HTMLVideoElement !== "undefined" && value instanceof HTMLVideoElement
  )
}

function tileEventTarget(event: Event): EventTarget | null {
  return event.composedPath()[0] ?? event.target ?? null
}

function tileLoadDetail(event: Event): TileLoadDetail | null {
  const detail = Reflect.get(event, "detail")
  if (!isRecord(detail)) return null

  const participant = detail.participant
  const videoElement = detail.videoElement
  if (!isRecord(participant) || !isVideoElement(videoElement)) return null

  const participantId = participant.id
  if (typeof participantId !== "string" || participantId.length === 0) {
    return null
  }

  return {
    participantId,
    videoElement,
    tileTarget: tileEventTarget(event),
  }
}

function tileUnloadParticipantId(event: Event): string | null {
  const detail = Reflect.get(event, "detail")
  if (!isRecord(detail)) return null

  const participantId = detail.id
  return typeof participantId === "string" && participantId.length > 0
    ? participantId
    : null
}

export function createPictureInPictureTileRegistry(): PictureInPictureTileRegistry {
  const participantVideos = new Map<
    HTMLVideoElement,
    PictureInPictureVideoRegistration
  >()

  const handleTileLoad = (event: Event): void => {
    const detail = tileLoadDetail(event)
    if (detail) {
      participantVideos.set(detail.videoElement, {
        participantId: detail.participantId,
        tileTarget: detail.tileTarget,
      })
    }
  }

  const handleTileUnload = (event: Event): void => {
    const tileTarget = tileEventTarget(event)
    const participantId = tileUnloadParticipantId(event)
    let removedForTile = false

    if (tileTarget) {
      for (const [video, registration] of participantVideos) {
        if (registration.tileTarget === tileTarget) {
          participantVideos.delete(video)
          removedForTile = true
        }
      }
    }

    if (removedForTile || !participantId) return

    // Older event shapes may not expose a stable tile target. Only remove a
    // participant entry when it is unambiguous; never unload every same-user
    // preview when multiple tiles are rendered for that participant.
    let matchingVideo: HTMLVideoElement | null = null
    let matchingCount = 0
    for (const [video, registration] of participantVideos) {
      if (registration.participantId === participantId) {
        matchingVideo = video
        matchingCount += 1
      }
    }
    if (matchingCount === 1 && matchingVideo) {
      participantVideos.delete(matchingVideo)
    }
  }

  return {
    attach(root: EventTarget): () => void {
      root.addEventListener("tileLoad", handleTileLoad)
      root.addEventListener("tileUnload", handleTileUnload)

      return () => {
        root.removeEventListener("tileLoad", handleTileLoad)
        root.removeEventListener("tileUnload", handleTileUnload)
        participantVideos.clear()
      }
    },
    getCandidates(
      selfParticipantId: string
    ): readonly PictureInPictureVideoCandidate<HTMLVideoElement>[] {
      return Array.from(participantVideos.entries())
        .filter(([video]) => video.isConnected)
        .map(([video, registration]) => ({
          video,
          isSelfPreview: registration.participantId === selfParticipantId,
          isReady: video.videoWidth > 0 && video.videoHeight > 0,
          canUsePictureInPicture: !video.disablePictureInPicture,
        }))
    },
  }
}

export function selectPictureInPictureVideo<T>(
  candidates: readonly PictureInPictureVideoCandidate<T>[]
): T | null {
  const eligible = candidates.filter(
    (candidate) => candidate.canUsePictureInPicture
  )
  const ready = (candidate: PictureInPictureVideoCandidate<T>): boolean =>
    candidate.isReady

  return (
    eligible.find((candidate) => candidate.isSelfPreview && ready(candidate))?.video ??
    eligible.find(ready)?.video ??
    eligible.find((candidate) => candidate.isSelfPreview)?.video ??
    eligible[0]?.video ??
    null
  )
}
