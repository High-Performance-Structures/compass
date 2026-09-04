"use client"

import * as React from "react"
import { CircleAlert, Loader2, Radio } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useMusicDucking } from "@/hooks/use-music-ducking"
import {
  findPreferredMusicLink,
  isSynchronizedMusicProvider,
  listeningPlaybackPositionMs,
  musicProviderLabel,
  soundCloudTrackUrl,
  youtubeVideoId,
  type ListeningPlaybackState,
  type MusicProvider,
} from "@/lib/listening-room"

type PlayerTrack = {
  readonly id: string
  readonly title: string
  readonly artist: string | null
  readonly links: readonly {
    readonly provider: MusicProvider
    readonly url: string
  }[]
}

type PlaybackClock = {
  readonly playbackState: ListeningPlaybackState
  readonly anchorPositionMs: number
  readonly playbackStartedAt: string | null
  readonly serverTime: string
}
type PlaybackTiming = Omit<PlaybackClock, "serverTime">

type PlayerProps = {
  readonly channelId: string
  readonly clock: PlaybackClock
  readonly track: PlayerTrack
  readonly provider: MusicProvider
  readonly joined: boolean
  readonly onAddProviderLink: () => void
  readonly onEnded: () => void
}

type YouTubePlayer = {
  readonly playVideo: () => void
  readonly pauseVideo: () => void
  readonly seekTo: (seconds: number, allowSeekAhead: boolean) => void
  readonly getCurrentTime: () => number
  readonly getVolume: () => number
  readonly setVolume: (volume: number) => void
  readonly destroy: () => void
}

type YouTubePlayerEvent = { readonly target: YouTubePlayer }
type YouTubeStateEvent = YouTubePlayerEvent & { readonly data: number }
type YouTubePlayerOptions = {
  readonly videoId: string
  readonly width: string
  readonly height: string
  readonly playerVars: {
    readonly autoplay: 0
    readonly controls: 1
    readonly playsinline: 1
    readonly rel: 0
  }
  readonly events: {
    readonly onReady: (event: YouTubePlayerEvent) => void
    readonly onStateChange: (event: YouTubeStateEvent) => void
    readonly onAutoplayBlocked: () => void
  }
}
type YouTubeNamespace = {
  readonly Player: new (
    element: HTMLElement,
    options: YouTubePlayerOptions
  ) => YouTubePlayer
}

type SoundCloudWidget = {
  readonly bind: (event: string, listener: () => void) => void
  readonly unbind: (event: string) => void
  readonly play: () => void
  readonly pause: () => void
  readonly seekTo: (milliseconds: number) => void
  readonly getPosition: (listener: (milliseconds: number) => void) => void
  readonly getVolume: (listener: (volume: number) => void) => void
  readonly setVolume: (volume: number) => void
}
type SoundCloudWidgetFactory = {
  (iframe: HTMLIFrameElement): SoundCloudWidget
  readonly Events: {
    readonly READY: string
    readonly FINISH: string
    readonly PLAY: string
    readonly PAUSE: string
  }
}
type SoundCloudNamespace = { readonly Widget: SoundCloudWidgetFactory }

type VolumeController = {
  readonly getVolume: (listener: (volume: number) => void) => void
  readonly setVolume: (volume: number) => void
}

declare global {
  interface Window {
    YT?: YouTubeNamespace
    onYouTubeIframeAPIReady?: () => void
    SC?: SoundCloudNamespace
  }
}

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  return new Promise((resolve, reject) => {
    if (window.YT) {
      resolve(window.YT)
      return
    }
    const previousReady = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.()
      if (window.YT) resolve(window.YT)
      else reject(new Error("YouTube player did not initialize"))
    }
    if (!document.getElementById("youtube-iframe-api")) {
      const script = document.createElement("script")
      script.id = "youtube-iframe-api"
      script.src = "https://www.youtube.com/iframe_api"
      script.async = true
      script.addEventListener("error", () =>
        reject(new Error("Unable to load the YouTube player"))
      )
      document.head.appendChild(script)
    }
  })
}

function loadSoundCloudApi(): Promise<SoundCloudNamespace> {
  return new Promise((resolve, reject) => {
    if (window.SC) {
      resolve(window.SC)
      return
    }
    const existing = document.getElementById("soundcloud-widget-api")
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.SC) resolve(window.SC)
        else reject(new Error("SoundCloud player did not initialize"))
      })
      return
    }
    const script = document.createElement("script")
    script.id = "soundcloud-widget-api"
    script.src = "https://w.soundcloud.com/player/api.js"
    script.async = true
    script.addEventListener("load", () => {
      if (window.SC) resolve(window.SC)
      else reject(new Error("SoundCloud player did not initialize"))
    })
    script.addEventListener("error", () =>
      reject(new Error("Unable to load the SoundCloud player"))
    )
    document.head.appendChild(script)
  })
}

function serverOffsetMs(serverTimeValue: string): number {
  const serverTime = Date.parse(serverTimeValue)
  return Number.isFinite(serverTime) ? serverTime - Date.now() : 0
}

function expectedPositionMs(clock: PlaybackTiming, offsetMs: number): number {
  return listeningPlaybackPositionMs({
    state: clock.playbackState,
    anchorPositionMs: clock.anchorPositionMs,
    playbackStartedAt: clock.playbackStartedAt,
    nowMs: Date.now() + offsetMs,
  })
}

function scheduledDelayMs(clock: PlaybackTiming, offsetMs: number): number {
  if (!clock.playbackStartedAt) return 0
  const startsAt = Date.parse(clock.playbackStartedAt)
  return Number.isFinite(startsAt)
    ? Math.max(0, startsAt - (Date.now() + offsetMs))
    : 0
}

function useDuckedVolume(input: {
  readonly controller: VolumeController | null
  readonly ducked: boolean
}): void {
  const baselineVolumeRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    baselineVolumeRef.current = null
  }, [input.controller])

  React.useEffect(() => {
    const controller = input.controller
    if (!controller) return
    let cancelled = false

    if (input.ducked) {
      controller.getVolume((volume) => {
        if (cancelled) return
        if (baselineVolumeRef.current === null) {
          baselineVolumeRef.current = volume
        }
        controller.setVolume(Math.min(volume, 25))
      })
    } else if (baselineVolumeRef.current !== null) {
      controller.setVolume(baselineVolumeRef.current)
      baselineVolumeRef.current = null
    }

    return () => {
      cancelled = true
    }
  }, [input.controller, input.ducked])
}

function useSynchronizedController(input: {
  readonly clock: PlaybackClock
  readonly controller: {
    readonly play: () => void
    readonly pause: () => void
    readonly seekTo: (milliseconds: number) => void
    readonly getPosition: (listener: (milliseconds: number) => void) => void
  } | null
}): void {
  const timing = React.useMemo<PlaybackTiming>(
    () => ({
      playbackState: input.clock.playbackState,
      anchorPositionMs: input.clock.anchorPositionMs,
      playbackStartedAt: input.clock.playbackStartedAt,
    }),
    [
      input.clock.anchorPositionMs,
      input.clock.playbackStartedAt,
      input.clock.playbackState,
    ]
  )
  const offsetRef = React.useRef(serverOffsetMs(input.clock.serverTime))
  React.useEffect(() => {
    offsetRef.current = serverOffsetMs(input.clock.serverTime)
  }, [input.clock.serverTime])

  React.useEffect(() => {
    const controller = input.controller
    if (!controller) return
    let startTimer: number | null = null
    const offsetMs = offsetRef.current
    const positionMs = expectedPositionMs(timing, offsetMs)
    controller.pause()
    controller.seekTo(positionMs)
    if (timing.playbackState === "playing") {
      const delayMs = scheduledDelayMs(timing, offsetMs)
      startTimer = window.setTimeout(() => {
        controller.seekTo(expectedPositionMs(timing, offsetRef.current))
        controller.play()
      }, delayMs)
    }
    return () => {
      if (startTimer !== null) window.clearTimeout(startTimer)
    }
  }, [
    timing,
    input.controller,
  ])

  React.useEffect(() => {
    const controller = input.controller
    if (!controller || timing.playbackState !== "playing") return
    const interval = window.setInterval(() => {
      controller.getPosition((actualMs) => {
        const expectedMs = expectedPositionMs(timing, offsetRef.current)
        if (Math.abs(actualMs - expectedMs) > 750) {
          controller.seekTo(expectedMs)
        }
      })
    }, 5_000)
    return () => window.clearInterval(interval)
  }, [timing, input.controller])
}

function YouTubePlayerView({
  clock,
  videoId,
  ducked,
  onEnded,
}: {
  readonly clock: PlaybackClock
  readonly videoId: string
  readonly ducked: boolean
  readonly onEnded: () => void
}): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const endedRef = React.useRef(false)
  const onEndedRef = React.useRef(onEnded)
  const [player, setPlayer] = React.useState<YouTubePlayer | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [autoplayBlocked, setAutoplayBlocked] = React.useState(false)

  React.useEffect(() => {
    onEndedRef.current = onEnded
  }, [onEnded])

  React.useEffect(() => {
    const element = containerRef.current
    if (!element) return
    let disposed = false
    let createdPlayer: YouTubePlayer | null = null
    void loadYouTubeApi()
      .then((youtube) => {
        if (disposed) return
        createdPlayer = new youtube.Player(element, {
          videoId,
          width: "100%",
          height: "220",
          playerVars: { autoplay: 0, controls: 1, playsinline: 1, rel: 0 },
          events: {
            onReady: (event) => setPlayer(event.target),
            onStateChange: (event) => {
              if (event.data === 0 && !endedRef.current) {
                endedRef.current = true
                onEndedRef.current()
              }
            },
            onAutoplayBlocked: () => setAutoplayBlocked(true),
          },
        })
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "YouTube player failed")
      })
    return () => {
      disposed = true
      createdPlayer?.destroy()
    }
  }, [videoId])

  const controller = React.useMemo(() => {
    if (!player) return null
    return {
      play: () => player.playVideo(),
      pause: () => player.pauseVideo(),
      seekTo: (milliseconds: number) =>
        player.seekTo(Math.max(0, milliseconds) / 1_000, true),
      getPosition: (listener: (milliseconds: number) => void) =>
        listener(player.getCurrentTime() * 1_000),
    }
  }, [player])
  useSynchronizedController({ clock, controller })
  const volumeController = React.useMemo<VolumeController | null>(() => {
    if (!player) return null
    return {
      getVolume: (listener) => listener(player.getVolume()),
      setVolume: (volume) => player.setVolume(volume),
    }
  }, [player])
  useDuckedVolume({ controller: volumeController, ducked })

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="min-h-40 overflow-hidden rounded-lg bg-muted" />
      {error ? <PlayerNotice icon="error" text={error} /> : null}
      {autoplayBlocked ? (
        <PlayerNotice
          icon="error"
          text="Your browser blocked automatic playback. Press play once in the YouTube player; Compass will keep it synchronized after that."
        />
      ) : null}
    </div>
  )
}

function SoundCloudPlayerView({
  clock,
  url,
  ducked,
  onEnded,
}: {
  readonly clock: PlaybackClock
  readonly url: string
  readonly ducked: boolean
  readonly onEnded: () => void
}): React.ReactElement {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const endedRef = React.useRef(false)
  const onEndedRef = React.useRef(onEnded)
  const [widget, setWidget] = React.useState<SoundCloudWidget | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const embedUrl = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false&show_artwork=true&visual=false`

  React.useEffect(() => {
    onEndedRef.current = onEnded
  }, [onEnded])

  React.useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    let disposed = false
    let createdWidget: SoundCloudWidget | null = null
    let finishEvent: string | null = null
    void loadSoundCloudApi()
      .then((soundCloud) => {
        if (disposed) return
        createdWidget = soundCloud.Widget(iframe)
        finishEvent = soundCloud.Widget.Events.FINISH
        createdWidget.bind(soundCloud.Widget.Events.READY, () => {
          if (!disposed) setWidget(createdWidget)
        })
        createdWidget.bind(soundCloud.Widget.Events.FINISH, () => {
          if (!endedRef.current) {
            endedRef.current = true
            onEndedRef.current()
          }
        })
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : "SoundCloud player failed"
        )
      })
    return () => {
      disposed = true
      if (createdWidget && finishEvent) createdWidget.unbind(finishEvent)
    }
  }, [])

  const controller = React.useMemo(() => {
    if (!widget) return null
    return {
      play: () => widget.play(),
      pause: () => widget.pause(),
      seekTo: (milliseconds: number) => widget.seekTo(Math.max(0, milliseconds)),
      getPosition: (listener: (milliseconds: number) => void) =>
        widget.getPosition(listener),
    }
  }, [widget])
  useSynchronizedController({ clock, controller })
  const volumeController = React.useMemo<VolumeController | null>(() => {
    if (!widget) return null
    return {
      getVolume: (listener) => widget.getVolume(listener),
      setVolume: (volume) => widget.setVolume(volume),
    }
  }, [widget])
  useDuckedVolume({ controller: volumeController, ducked })

  return (
    <div className="space-y-2">
      <iframe
        ref={iframeRef}
        title="Synchronized SoundCloud player"
        src={embedUrl}
        className="h-40 w-full rounded-lg border-0"
        allow="autoplay"
      />
      {error ? <PlayerNotice icon="error" text={error} /> : null}
    </div>
  )
}

function PlayerNotice({
  icon,
  text,
}: {
  readonly icon: "loading" | "error"
  readonly text: string
}): React.ReactElement {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      {icon === "loading" ? (
        <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
      ) : (
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      )}
      {text}
    </p>
  )
}

export function ListeningRoomPlayer({
  channelId,
  clock,
  track,
  provider,
  joined,
  onAddProviderLink,
  onEnded,
}: PlayerProps): React.ReactElement {
  const [enabled, setEnabled] = React.useState(false)
  const ducked = useMusicDucking(channelId)
  const link = findPreferredMusicLink(track.links, provider)
  const synchronized = isSynchronizedMusicProvider(provider)
  const youtubeId = provider === "youtube" && link
    ? youtubeVideoId(link.url)
    : null
  const soundCloudUrl = provider === "soundcloud" && link
    ? soundCloudTrackUrl(link.url)
    : null

  React.useEffect(() => setEnabled(false), [provider])

  if (!joined) {
    return (
      <PlayerNotice
        icon="error"
        text="Join the room and choose a service to hear synchronized playback."
      />
    )
  }
  if (!synchronized) {
    return (
      <PlayerNotice
        icon="error"
        text={`${musicProviderLabel(provider)} is link-only for now. Choose YouTube or SoundCloud for synchronized playback.`}
      />
    )
  }
  if (!link || (provider === "youtube" && !youtubeId) || (provider === "soundcloud" && !soundCloudUrl)) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <PlayerNotice
          icon="error"
          text={`This track needs an exact ${musicProviderLabel(provider)} link before it can play here.`}
        />
        <Button type="button" size="sm" variant="outline" onClick={onAddProviderLink}>
          Add {musicProviderLabel(provider)} link
        </Button>
      </div>
    )
  }
  if (!enabled) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="max-w-md text-xs text-muted-foreground">
          Enable once so your browser permits audio. Compass will then start,
          pause, seek, and advance this embedded player with the room.
        </p>
        <Button type="button" size="sm" onClick={() => setEnabled(true)}>
          <Radio /> Enable synced playback
        </Button>
      </div>
    )
  }

  if (provider === "youtube" && youtubeId) {
    return (
      <YouTubePlayerView
        key={`${track.id}:${youtubeId}`}
        clock={clock}
        videoId={youtubeId}
        ducked={ducked}
        onEnded={onEnded}
      />
    )
  }
  if (provider === "soundcloud" && soundCloudUrl) {
    return (
      <SoundCloudPlayerView
        key={`${track.id}:${soundCloudUrl}`}
        clock={clock}
        url={soundCloudUrl}
        ducked={ducked}
        onEnded={onEnded}
      />
    )
  }
  return <PlayerNotice icon="loading" text="Preparing synchronized player…" />
}
