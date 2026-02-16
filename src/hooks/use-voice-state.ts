"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"

type VoiceState = {
  // Connection
  channelId: string | null
  channelName: string
  // Toggles
  isMuted: boolean
  isDeafened: boolean
  isScreenSharing: boolean
  isCameraOn: boolean
  isNoiseSuppression: boolean
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
  joinChannel: (id: string, name: string) => void
  leaveChannel: () => void
}

export type VoiceContextValue = VoiceState & VoiceActions

export const VoiceContext = createContext<VoiceContextValue | null>(null)

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

  // Toggle state
  const [isMuted, setIsMuted] = useState<boolean>(false)
  const [isDeafened, setIsDeafened] = useState<boolean>(false)
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false)
  const [isCameraOn, setIsCameraOn] = useState<boolean>(false)
  const [isNoiseSuppression, setIsNoiseSuppression] = useState<boolean>(true)

  // Device state
  const [inputDeviceId, setInputDeviceId] = useState<string | undefined>(undefined)
  const [outputDeviceId, setOutputDeviceId] = useState<string | undefined>(undefined)
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])

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

  // Device setters
  const setInputDevice = useCallback((deviceId: string): void => {
    setInputDeviceId(deviceId)
  }, [])

  const setOutputDevice = useCallback((deviceId: string): void => {
    setOutputDeviceId(deviceId)
  }, [])

  // Channel management
  const joinChannel = useCallback((id: string, name: string): void => {
    setChannelId(id)
    setChannelName(name)
  }, [])

  const leaveChannel = useCallback((): void => {
    setChannelId(null)
    setChannelName("")
  }, [])

  return {
    // State
    channelId,
    channelName,
    isMuted,
    isDeafened,
    isScreenSharing,
    isCameraOn,
    isNoiseSuppression,
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
    joinChannel,
    leaveChannel,
  }
}
