"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  joinVoiceSession,
  leaveVoiceSession,
  pollVoiceSession,
  sendVoiceSignal,
  updateVoicePresence,
  type VoiceParticipantData,
} from "@/app/actions/voice-sessions"
import { useVoiceActivityPublisher } from "@/hooks/use-music-ducking"

type VoiceConnectionStatus = "idle" | "connecting" | "connected" | "error"

type RemoteVoiceStream = {
  readonly userId: string
  readonly displayName: string | null
  readonly stream: MediaStream
}

type VoiceState = {
  // Connection
  channelId: string | null
  channelName: string
  connectionStatus: VoiceConnectionStatus
  connectionError: string | null
  participants: readonly VoiceParticipantData[]
  remoteStreams: readonly RemoteVoiceStream[]
  // Toggles
  isMuted: boolean
  isDeafened: boolean
  isScreenSharing: boolean
  isCameraOn: boolean
  isNoiseSuppression: boolean
  isRealtimeMeetingActive: boolean
  // Device selection
  inputDeviceId: string | undefined
  outputDeviceId: string | undefined
  // Device lists (from enumerateDevices)
  inputDevices: MediaDeviceInfo[]
  outputDevices: MediaDeviceInfo[]
}

type VoiceActions = {
  toggleMute: () => void
  toggleDeafen: () => void
  toggleScreenShare: () => void
  toggleCamera: () => void
  toggleNoiseSuppression: () => void
  setInputDevice: (deviceId: string) => void
  setOutputDevice: (deviceId: string) => void
  setRealtimeMeetingActive: (active: boolean) => void
  suspendChannelAudio: () => void
  joinChannel: (id: string, name: string) => void
  leaveChannel: () => void
}

export type VoiceContextValue = VoiceState & VoiceActions

export const VoiceContext = createContext<VoiceContextValue | null>(null)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}

function parseSessionDescription(
  payloadJson: string
): RTCSessionDescriptionInit | null {
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    if (!isRecord(parsed)) return null
    const type = parsed.type
    const sdp = parsed.sdp
    if (
      (type === "offer" ||
        type === "answer" ||
        type === "pranswer" ||
        type === "rollback") &&
      typeof sdp === "string"
    ) {
      return { type, sdp }
    }
    return null
  } catch {
    return null
  }
}

function parseIceCandidate(payloadJson: string): RTCIceCandidateInit | null {
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    if (!isRecord(parsed)) return null
    const candidate = parsed.candidate
    const sdpMid = parsed.sdpMid
    const sdpMLineIndex = parsed.sdpMLineIndex
    const usernameFragment = parsed.usernameFragment

    return {
      candidate: typeof candidate === "string" ? candidate : undefined,
      sdpMid:
        typeof sdpMid === "string" || sdpMid === null ? sdpMid : undefined,
      sdpMLineIndex:
        typeof sdpMLineIndex === "number" || sdpMLineIndex === null
          ? sdpMLineIndex
          : undefined,
      usernameFragment:
        typeof usernameFragment === "string" ? usernameFragment : undefined,
    }
  } catch {
    return null
  }
}

export function useVoiceState(): VoiceContextValue {
  const context = useContext(VoiceContext)
  if (!context) {
    throw new Error("useVoiceState must be used within VoiceProvider")
  }
  return context
}

export function useVoiceStateLogic(): VoiceContextValue {
  // Connection state
  const [channelId, setChannelId] = useState<string | null>(null)
  const [channelName, setChannelName] = useState<string>("")
  const [connectionStatus, setConnectionStatus] =
    useState<VoiceConnectionStatus>("idle")
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<readonly VoiceParticipantData[]>(
    []
  )
  const [remoteStreams, setRemoteStreams] = useState<readonly RemoteVoiceStream[]>(
    []
  )

  // Toggle state
  const [isMuted, setIsMuted] = useState<boolean>(false)
  const [isDeafened, setIsDeafened] = useState<boolean>(false)
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false)
  const [isCameraOn, setIsCameraOn] = useState<boolean>(false)
  const [isNoiseSuppression, setIsNoiseSuppression] = useState<boolean>(true)
  const [isRealtimeMeetingActive, setIsRealtimeMeetingActive] =
    useState<boolean>(false)

  // Device state
  const [inputDeviceId, setInputDeviceId] = useState<string | undefined>(undefined)
  const [outputDeviceId, setOutputDeviceId] = useState<string | undefined>(undefined)
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)

  const channelIdRef = useRef<string | null>(null)
  const channelNameRef = useRef("")
  const selfUserIdRef = useRef<string | null>(null)
  const isMutedRef = useRef(false)
  const isDeafenedRef = useRef(false)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const participantsRef = useRef<Map<string, VoiceParticipantData>>(new Map())
  const lastSignalAtRef = useRef<string | undefined>(undefined)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const getVoiceTracks = useCallback((): readonly MediaStreamTrack[] => {
    const tracks: MediaStreamTrack[] = []
    const local = localStreamRef.current
    if (local) tracks.push(...local.getAudioTracks())
    for (const remote of remoteStreamsRef.current.values()) {
      tracks.push(...remote.getAudioTracks())
    }
    return tracks
  }, [])
  useVoiceActivityPublisher({ channelId, getTracks: getVoiceTracks })

  // Load devices
  const loadDevices = useCallback(async (): Promise<void> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs = devices.filter((device) => device.kind === "audioinput")
      const outputs = devices.filter((device) => device.kind === "audiooutput")

      setInputDevices(inputs)
      setOutputDevices(outputs)

      // Set defaults if not already set
      if (!inputDeviceId && inputs.length > 0) {
        setInputDeviceId(inputs[0].deviceId)
      }
      if (!outputDeviceId && outputs.length > 0) {
        setOutputDeviceId(outputs[0].deviceId)
      }
    } catch (error) {
      console.error("Failed to enumerate devices:", error)
    }
  }, [inputDeviceId, outputDeviceId])

  // Listen for device changes
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      return
    }

    loadDevices()

    const handleDeviceChange = (): void => {
      loadDevices()
    }

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange)
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange)
    }
  }, [loadDevices])

  useEffect(() => {
    localStreamRef.current = localStream
  }, [localStream])

  useEffect(() => {
    channelIdRef.current = channelId
  }, [channelId])

  useEffect(() => {
    channelNameRef.current = channelName
  }, [channelName])

  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

  useEffect(() => {
    isDeafenedRef.current = isDeafened
  }, [isDeafened])

  useEffect(() => {
    if (!localStream) return
    for (const track of localStream.getAudioTracks()) {
      track.enabled = !isMuted && !isDeafened && !isRealtimeMeetingActive
    }
  }, [isMuted, isDeafened, isRealtimeMeetingActive, localStream])

  useEffect(() => {
    if (!channelId) return
    void updateVoicePresence(channelId, { isMuted, isDeafened })
  }, [channelId, isMuted, isDeafened])

  const refreshRemoteStreams = useCallback((): void => {
    setRemoteStreams(
      Array.from(remoteStreamsRef.current.entries()).map(([userId, stream]) => ({
        userId,
        displayName: participantsRef.current.get(userId)?.displayName ?? null,
        stream,
      }))
    )
  }, [])

  const closePeer = useCallback(
    (userId: string): void => {
      const peer = peerConnectionsRef.current.get(userId)
      if (peer) {
        peer.close()
        peerConnectionsRef.current.delete(userId)
      }
      pendingIceRef.current.delete(userId)
      remoteStreamsRef.current.delete(userId)
      refreshRemoteStreams()
    },
    [refreshRemoteStreams]
  )

  const cleanupVoice = useCallback((): void => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    for (const peer of peerConnectionsRef.current.values()) {
      peer.close()
    }
    peerConnectionsRef.current.clear()
    pendingIceRef.current.clear()
    remoteStreamsRef.current.clear()
    participantsRef.current.clear()
    lastSignalAtRef.current = undefined
    selfUserIdRef.current = null
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop()
      }
    }
    localStreamRef.current = null
    setLocalStream(null)
    setRemoteStreams([])
    setParticipants([])
  }, [])

  const flushPendingIce = useCallback(async (userId: string): Promise<void> => {
    const peer = peerConnectionsRef.current.get(userId)
    if (!peer || !peer.remoteDescription) return
    const pending = pendingIceRef.current.get(userId) ?? []
    pendingIceRef.current.delete(userId)
    for (const candidate of pending) {
      await peer.addIceCandidate(candidate)
    }
  }, [])

  const createPeerConnection = useCallback(
    (remoteUserId: string): RTCPeerConnection | null => {
      const existing = peerConnectionsRef.current.get(remoteUserId)
      if (existing) return existing

      const currentChannelId = channelIdRef.current
      const stream = localStreamRef.current
      if (!currentChannelId || !stream) return null

      const peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      })

      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream)
      }

      peer.onicecandidate = (event): void => {
        if (!event.candidate) return
        void sendVoiceSignal({
          channelId: currentChannelId,
          targetUserId: remoteUserId,
          signalType: "ice",
          payloadJson: JSON.stringify(event.candidate.toJSON()),
        })
      }

      peer.ontrack = (event): void => {
        const [remoteStream] = event.streams
        if (!remoteStream) return
        remoteStreamsRef.current.set(remoteUserId, remoteStream)
        refreshRemoteStreams()
      }

      peer.onconnectionstatechange = (): void => {
        if (
          peer.connectionState === "failed" ||
          peer.connectionState === "closed"
        ) {
          closePeer(remoteUserId)
        }
      }

      peerConnectionsRef.current.set(remoteUserId, peer)
      return peer
    },
    [closePeer, refreshRemoteStreams]
  )

  const sendOffer = useCallback(
    async (remoteUserId: string): Promise<void> => {
      const currentChannelId = channelIdRef.current
      const peer = createPeerConnection(remoteUserId)
      if (!currentChannelId || !peer || peer.signalingState !== "stable") return

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await sendVoiceSignal({
        channelId: currentChannelId,
        targetUserId: remoteUserId,
        signalType: "offer",
        payloadJson: JSON.stringify(offer),
      })
    },
    [createPeerConnection]
  )

  const syncParticipants = useCallback(
    (nextParticipants: readonly VoiceParticipantData[]): void => {
      const nextMap = new Map(
        nextParticipants.map((participant) => [participant.userId, participant])
      )
      participantsRef.current = nextMap
      setParticipants(nextParticipants)
      refreshRemoteStreams()

      const selfUserId = selfUserIdRef.current
      if (!selfUserId) return

      for (const participant of nextParticipants) {
        if (participant.userId === selfUserId) continue
        if (!peerConnectionsRef.current.has(participant.userId)) {
          createPeerConnection(participant.userId)
          if (selfUserId < participant.userId) {
            void sendOffer(participant.userId)
          }
        }
      }

      for (const userId of Array.from(peerConnectionsRef.current.keys())) {
        if (!nextMap.has(userId)) {
          closePeer(userId)
        }
      }
    },
    [closePeer, createPeerConnection, refreshRemoteStreams, sendOffer]
  )

  const handleSignal = useCallback(
    async (signal: {
      readonly senderUserId: string
      readonly signalType: "offer" | "answer" | "ice"
      readonly payloadJson: string
    }): Promise<void> => {
      const currentChannelId = channelIdRef.current
      if (!currentChannelId) return
      const peer = createPeerConnection(signal.senderUserId)
      if (!peer) return

      if (signal.signalType === "offer") {
        const description = parseSessionDescription(signal.payloadJson)
        if (!description) return
        await peer.setRemoteDescription(description)
        await flushPendingIce(signal.senderUserId)
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        await sendVoiceSignal({
          channelId: currentChannelId,
          targetUserId: signal.senderUserId,
          signalType: "answer",
          payloadJson: JSON.stringify(answer),
        })
        return
      }

      if (signal.signalType === "answer") {
        const description = parseSessionDescription(signal.payloadJson)
        if (!description) return
        if (peer.signalingState !== "stable") {
          await peer.setRemoteDescription(description)
          await flushPendingIce(signal.senderUserId)
        }
        return
      }

      const candidate = parseIceCandidate(signal.payloadJson)
      if (!candidate) return
      if (peer.remoteDescription) {
        await peer.addIceCandidate(candidate)
        return
      }
      const pending = pendingIceRef.current.get(signal.senderUserId) ?? []
      pending.push(candidate)
      pendingIceRef.current.set(signal.senderUserId, pending)
    },
    [createPeerConnection, flushPendingIce]
  )

  const pollVoice = useCallback(async (): Promise<void> => {
    const currentChannelId = channelIdRef.current
    if (!currentChannelId) return

    const result = await pollVoiceSession(currentChannelId, lastSignalAtRef.current)
    if (!result.success) {
      setConnectionStatus("error")
      setConnectionError(result.error)
      return
    }

    syncParticipants(result.data.participants)
    for (const signal of result.data.signals) {
      lastSignalAtRef.current = signal.createdAt
      await handleSignal(signal)
    }
  }, [handleSignal, syncParticipants])

  // Toggle functions
  const toggleMute = useCallback((): void => {
    if (isDeafened) {
      // Un-deafen and un-mute
      setIsDeafened(false)
      setIsMuted(false)
    } else {
      setIsMuted((prev) => !prev)
    }
  }, [isDeafened])

  const toggleDeafen = useCallback((): void => {
    setIsDeafened((prev) => {
      const newDeafened = !prev
      if (newDeafened) {
        // Auto-mute when deafening
        setIsMuted(true)
      }
      return newDeafened
    })
  }, [])

  const toggleScreenShare = useCallback((): void => {
    setIsScreenSharing((prev) => !prev)
  }, [])

  const toggleCamera = useCallback((): void => {
    setIsCameraOn((prev) => !prev)
  }, [])

  const toggleNoiseSuppression = useCallback((): void => {
    setIsNoiseSuppression((prev) => !prev)
  }, [])

  const setRealtimeMeetingActive = useCallback((active: boolean): void => {
    setIsRealtimeMeetingActive(active)
    const stream = localStreamRef.current
    if (!stream) return
    for (const track of stream.getAudioTracks()) {
      track.enabled = !active && !isMutedRef.current && !isDeafenedRef.current
    }
  }, [])

  const suspendChannelAudio = useCallback((): void => {
    const currentChannelId = channelIdRef.current
    if (currentChannelId) {
      void leaveVoiceSession(currentChannelId)
    }
    cleanupVoice()
    setIsRealtimeMeetingActive(true)
    setConnectionStatus("idle")
    setConnectionError(null)
  }, [cleanupVoice])

  // Device setters
  const setInputDevice = useCallback((deviceId: string): void => {
    setInputDeviceId(deviceId)
  }, [])

  const setOutputDevice = useCallback((deviceId: string): void => {
    setOutputDeviceId(deviceId)
  }, [])

  // Channel management
  const joinChannel = useCallback(
    (id: string, name: string): void => {
      void (async () => {
        try {
          cleanupVoice()
          setConnectionStatus("connecting")
          setConnectionError(null)
          setChannelId(id)
          setChannelName(name)
          channelIdRef.current = id
          channelNameRef.current = name

          if (
            typeof navigator === "undefined" ||
            !navigator.mediaDevices?.getUserMedia
          ) {
            throw new Error("This browser does not support microphone access.")
          }

          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
              echoCancellation: true,
              noiseSuppression: isNoiseSuppression,
              autoGainControl: true,
            },
            video: false,
          })
          for (const track of stream.getAudioTracks()) {
            track.enabled = !isMuted && !isDeafened && !isRealtimeMeetingActive
          }
          localStreamRef.current = stream
          setLocalStream(stream)

          const joined = await joinVoiceSession(id, { isMuted, isDeafened })
          if (!joined.success) {
            throw new Error(joined.error)
          }

          selfUserIdRef.current = joined.data.self.userId
          syncParticipants(joined.data.participants)
          setConnectionStatus("connected")

          pollIntervalRef.current = setInterval(() => {
            void pollVoice()
          }, 1500)
          void pollVoice()
        } catch (error) {
          cleanupVoice()
          setChannelId(null)
          setChannelName("")
          setConnectionStatus("error")
          setConnectionError(
            error instanceof Error
              ? error.message
              : "Failed to join voice channel"
          )
        }
      })()
    },
    [
      cleanupVoice,
      inputDeviceId,
      isDeafened,
      isMuted,
      isNoiseSuppression,
      isRealtimeMeetingActive,
      pollVoice,
      syncParticipants,
    ]
  )

  const leaveChannel = useCallback((): void => {
    const currentChannelId = channelIdRef.current
    if (currentChannelId) {
      void leaveVoiceSession(currentChannelId)
    }
    cleanupVoice()
    setChannelId(null)
    setChannelName("")
    setConnectionStatus("idle")
    setConnectionError(null)
  }, [cleanupVoice])

  useEffect(() => {
    return () => {
      const currentChannelId = channelIdRef.current
      if (currentChannelId) {
        void leaveVoiceSession(currentChannelId)
      }
      cleanupVoice()
    }
  }, [cleanupVoice])

  return {
    // State
    channelId,
    channelName,
    connectionStatus,
    connectionError,
    participants,
    remoteStreams,
    isMuted,
    isDeafened,
    isScreenSharing,
    isCameraOn,
    isNoiseSuppression,
    isRealtimeMeetingActive,
    inputDeviceId,
    outputDeviceId,
    inputDevices,
    outputDevices,
    // Actions
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    toggleCamera,
    toggleNoiseSuppression,
    setInputDevice,
    setOutputDevice,
    setRealtimeMeetingActive,
    suspendChannelAudio,
    joinChannel,
    leaveChannel,
  }
}
