export type PictureInPictureVideoCandidate<T> = {
  readonly video: T
  readonly isSelfPreview: boolean
  readonly isReady: boolean
  readonly canUsePictureInPicture: boolean
}

type PictureInPictureTileRegistry = {
  readonly attach: (
    root: EventTarget,
    onVideoRemoved?: (video: HTMLVideoElement) => void
  ) => () => void
  readonly getCandidates: (
    selfParticipantId: string
  ) => readonly PictureInPictureVideoCandidate<HTMLVideoElement>[]
  readonly hasVideo: (video: HTMLVideoElement) => boolean
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

export async function exitPictureInPictureIfElementMatches(
  video: HTMLVideoElement
): Promise<boolean> {
  const pendingExit = pendingPictureInPictureExits.get(video)
  if (pendingExit) return pendingExit
  if (
    typeof document === "undefined" ||
    document.pictureInPictureElement !== video
  ) {
    return false
  }

  const exit = document.exitPictureInPicture().then(
    () => true,
    () => false
  )
  pendingPictureInPictureExits.set(video, exit)
  void exit.finally(() => pendingPictureInPictureExits.delete(video))
  return exit
}

const pendingPictureInPictureExits = new WeakMap<
  HTMLVideoElement,
  Promise<boolean>
>()

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

function participantIdFromValue(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value
  if (!isRecord(value)) return null

  const directId = value.id
  if (typeof directId === "string" && directId.length > 0) return directId

  const participant = value.participant
  return participant === value ? null : participantIdFromValue(participant)
}

function tileLoadDetail(event: Event): TileLoadDetail | null {
  const detail = Reflect.get(event, "detail")
  if (!isRecord(detail)) return null

  const participant = detail.participant
  const videoElement = detail.videoElement
  if (!isRecord(participant) || !isVideoElement(videoElement)) return null

  const participantId = participantIdFromValue(participant)
  if (!participantId) return null

  return {
    participantId,
    videoElement,
    tileTarget: tileEventTarget(event),
  }
}

function tileUnloadParticipantId(event: Event): string | null {
  return participantIdFromValue(Reflect.get(event, "detail"))
}

function participantTileForVideo(video: HTMLVideoElement): Element | null {
  let current: Node | null = video
  while (current) {
    if (current instanceof Element && current.localName === "rtk-participant-tile") {
      return current
    }
    current = current instanceof ShadowRoot ? current.host : current.parentNode
  }
  return null
}

function scanExistingTiles(root: EventTarget): readonly TileLoadDetail[] {
  if (!(root instanceof Node)) return []

  const details: TileLoadDetail[] = []
  const visit = (node: Node): void => {
    if (node instanceof HTMLVideoElement) {
      const tileTarget = participantTileForVideo(node)
      const participantId = tileTarget
        ? participantIdFromValue(Reflect.get(tileTarget, "participant"))
        : null
      if (tileTarget && participantId) {
        details.push({
          participantId,
          videoElement: node,
          tileTarget,
        })
      }
    }

    if (node instanceof Element && node.shadowRoot) {
      visit(node.shadowRoot)
    }
    for (const child of node.childNodes) visit(child)
  }

  visit(root)
  return details
}

export function createPictureInPictureTileRegistry(): PictureInPictureTileRegistry {
  const participantVideos = new Map<
    HTMLVideoElement,
    PictureInPictureVideoRegistration
  >()
  const handledTileUnloadEvents = new WeakSet<Event>()
  let attachedRoot: EventTarget | null = null
  let detachAttachedRoot: (() => void) | null = null
  let onVideoRemoved: ((video: HTMLVideoElement) => void) | null = null

  const notifyVideoRemoved = (video: HTMLVideoElement): void => {
    onVideoRemoved?.(video)
  }

  const removeTileUnloadListener = (
    registration: PictureInPictureVideoRegistration
  ): void => {
    registration.tileTarget?.removeEventListener("tileUnload", handleTileUnloadFromTile)
  }

  const removeVideoRegistration = (
    video: HTMLVideoElement,
    notify = true
  ): boolean => {
    const registration = participantVideos.get(video)
    if (!registration) return false
    removeTileUnloadListener(registration)
    participantVideos.delete(video)
    if (notify) notifyVideoRemoved(video)
    return true
  }

  const processTileUnload = (event: Event): void => {
    const tileTarget = tileEventTarget(event)
    const participantId = tileUnloadParticipantId(event)
    let removedForTile = false

    if (tileTarget) {
      for (const [video, registration] of Array.from(participantVideos.entries())) {
        if (registration.tileTarget === tileTarget) {
          removedForTile = removeVideoRegistration(video) || removedForTile
        }
      }
    }

    if (removedForTile || !participantId) return

    let matchingVideo: HTMLVideoElement | null = null
    let matchingCount = 0
    for (const [video, registration] of participantVideos.entries()) {
      if (registration.participantId === participantId) {
        matchingVideo = video
        matchingCount += 1
      }
    }
    if (matchingCount === 1 && matchingVideo) {
      removeVideoRegistration(matchingVideo)
    }
  }

  const handleTileUnload = (event: Event): void => {
    if (handledTileUnloadEvents.has(event)) return
    processTileUnload(event)
  }

  const handleTileUnloadFromTile = (event: Event): void => {
    handledTileUnloadEvents.add(event)
    processTileUnload(event)
  }

  const registerTile = (detail: TileLoadDetail): void => {
    if (detail.tileTarget) {
      for (const [video, registration] of Array.from(participantVideos.entries())) {
        if (
          registration.tileTarget === detail.tileTarget &&
          video !== detail.videoElement
        ) {
          removeVideoRegistration(video)
        }
      }
    }
    removeVideoRegistration(detail.videoElement, false)
    detail.tileTarget?.addEventListener("tileUnload", handleTileUnloadFromTile)
    participantVideos.set(detail.videoElement, {
      participantId: detail.participantId,
      tileTarget: detail.tileTarget,
    })
  }

  const handleTileLoad = (event: Event): void => {
    const detail = tileLoadDetail(event)
    if (detail) registerTile(detail)
  }

  return {
    attach(
      root: EventTarget,
      videoRemovedHandler?: (video: HTMLVideoElement) => void
    ): () => void {
      if (attachedRoot === root && detachAttachedRoot) return detachAttachedRoot
      detachAttachedRoot?.()
      onVideoRemoved = videoRemovedHandler ?? null
      root.addEventListener("tileLoad", handleTileLoad)
      root.addEventListener("tileUnload", handleTileUnload)
      for (const detail of scanExistingTiles(root)) registerTile(detail)

      const detach = (): void => {
        if (attachedRoot !== root) return
        root.removeEventListener("tileLoad", handleTileLoad)
        root.removeEventListener("tileUnload", handleTileUnload)
        for (const video of Array.from(participantVideos.keys())) {
          removeVideoRegistration(video)
        }
        attachedRoot = null
        detachAttachedRoot = null
        onVideoRemoved = null
      }
      attachedRoot = root
      detachAttachedRoot = detach
      return detach
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
    hasVideo(video: HTMLVideoElement): boolean {
      return participantVideos.has(video)
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
