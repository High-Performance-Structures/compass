"use client"

import * as React from "react"
import { CircleAlert, Headphones, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useMusicDucking } from "@/hooks/use-music-ducking"
import {
  listeningPlaybackPositionMs,
  soundCloudTrackUrl,
  youtubeVideoId,
  type ListeningPlaybackState,
  type SynchronizedPlaybackLink,
} from "@/lib/listening-room"
import { cn } from "@/lib/utils"

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
  readonly trackId: string
  readonly link: SynchronizedPlaybackLink
  readonly audioEnabled: boolean
  readonly onEnableAudio: () => void
  /** The listener's own volume, 0–100; never shared with the room. */
  readonly volume: number
  readonly compact: boolean
  readonly onEnded: () => void
  readonly onDuration: (milliseconds: number) => void
}

type YouTubePlayer = {
  readonly playVideo: () => void
  readonly pauseVideo: () => void
  readonly seekTo: (seconds: number, allowSeekAhead: boolean) => void
  readonly getCurrentTime: () => number
  readonly getDuration: () => number
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
  readonly getDuration: (listener: (milliseconds: number) => void) => void
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

function useListenerVolume(input: {
  readonly controller: VolumeController | null
  readonly volume: number
  readonly ducked: boolean
}): void {
  React.useEffect(() => {
    const controller = input.controller
    if (!controller) return
    // Voice chat ducks music to a quarter so people can still talk over it.
    controller.setVolume(input.ducked ? Math.min(input.volume, 25) : input.volume)
  }, [input.controller, input.volume, input.ducked])
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
  volume,
  compact,
  onEnded,
  onDuration,
}: {
  readonly clock: PlaybackClock
  readonly videoId: string
  readonly ducked: boolean
  readonly volume: number
  readonly compact: boolean
  readonly onEnded: () => void
  readonly onDuration: (milliseconds: number) => void
}): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const endedRef = React.useRef(false)
  const onEndedRef = React.useRef(onEnded)
  const onDurationRef = React.useRef(onDuration)
  const [player, setPlayer] = React.useState<YouTubePlayer | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [autoplayBlocked, setAutoplayBlocked] = React.useState(false)

  React.useEffect(() => {
    onEndedRef.current = onEnded
    onDurationRef.current = onDuration
  }, [onEnded, onDuration])

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
          height: "100%",
          playerVars: { autoplay: 0, controls: 1, playsinline: 1, rel: 0 },
          events: {
            onReady: (event) => {
              setPlayer(event.target)
              onDurationRef.current(event.target.getDuration() * 1_000)
            },
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
  useListenerVolume({ controller: volumeController, volume, ducked })

  return (
    <div className="space-y-2">
      {/* The YouTube API replaces the inner element with its iframe, so the
          sized wrapper stays React-owned and the player survives resizing. */}
      <div className={playerFrameClass(compact)}>
        <div ref={containerRef} className="size-full" />
      </div>
      {error && !compact ? <PlayerNotice icon="error" text={error} /> : null}
      {autoplayBlocked && !compact ? (
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
  volume,
  compact,
  onEnded,
  onDuration,
}: {
  readonly clock: PlaybackClock
  readonly url: string
  readonly ducked: boolean
  readonly volume: number
  readonly compact: boolean
  readonly onEnded: () => void
  readonly onDuration: (milliseconds: number) => void
}): React.ReactElement {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const endedRef = React.useRef(false)
  const onEndedRef = React.useRef(onEnded)
  const onDurationRef = React.useRef(onDuration)
  const [widget, setWidget] = React.useState<SoundCloudWidget | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const embedUrl = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false&show_artwork=true&visual=false`

  React.useEffect(() => {
    onEndedRef.current = onEnded
    onDurationRef.current = onDuration
  }, [onEnded, onDuration])

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
          if (disposed || !createdWidget) return
          setWidget(createdWidget)
          createdWidget.getDuration((milliseconds) => onDurationRef.current(milliseconds))
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
  useListenerVolume({ controller: volumeController, volume, ducked })

  return (
    <div className="space-y-2">
      <div className={playerFrameClass(compact)}>
        <iframe
          ref={iframeRef}
          title="Synchronized SoundCloud player"
          src={embedUrl}
          className="size-full border-0"
          allow="autoplay"
        />
      </div>
      {error && !compact ? <PlayerNotice icon="error" text={error} /> : null}
    </div>
  )
}

function playerFrameClass(compact: boolean): string {
  return cn(
    "overflow-hidden rounded-lg bg-muted",
    compact ? "h-16 w-28" : "aspect-video w-full"
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
  trackId,
  link,
  audioEnabled,
  onEnableAudio,
  volume,
  compact,
  onEnded,
  onDuration,
}: PlayerProps): React.ReactElement {
  const ducked = useMusicDucking(channelId)
  const youtubeId = link.provider === "youtube" ? youtubeVideoId(link.url) : null
  const soundCloudUrl =
    link.provider === "soundcloud" ? soundCloudTrackUrl(link.url) : null

  if (!audioEnabled) {
    // Browsers only allow sound after a click on this page, so a fresh page
    // load asks once before the embedded player starts.
    return (
      <div className={cn(playerFrameClass(compact), "grid place-items-center")}>
        <Button type="button" size={compact ? "xs" : "sm"} onClick={onEnableAudio}>
          <Headphones /> {compact ? "Listen" : "Tap to listen"}
        </Button>
      </div>
    )
  }
  if (youtubeId) {
    return (
      <YouTubePlayerView
        key={`${trackId}:${youtubeId}`}
        clock={clock}
        videoId={youtubeId}
        ducked={ducked}
        volume={volume}
        compact={compact}
        onEnded={onEnded}
        onDuration={onDuration}
      />
    )
  }
  if (soundCloudUrl) {
    return (
      <SoundCloudPlayerView
        key={`${trackId}:${soundCloudUrl}`}
        clock={clock}
        url={soundCloudUrl}
        ducked={ducked}
        volume={volume}
        compact={compact}
        onEnded={onEnded}
        onDuration={onDuration}
      />
    )
  }
  return <PlayerNotice icon="error" text="This song's link can't be played here." />
}
