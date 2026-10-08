// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useMutedSpeechHint } from "../use-muted-speech-hint"

let level = 128
const stopTrack = vi.fn()
const closeContext = vi.fn(async () => {})

function Probe({ active, onSpeech }: { readonly active: boolean; readonly onSpeech: () => void }): null {
  useMutedSpeechHint({ active, microphoneId: "mic-1", onSpeech })
  return null
}

describe("useMutedSpeechHint", () => {
  let root: Root
  let getUserMedia: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    level = 128
    stopTrack.mockClear()
    getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }))
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } })
    vi.stubGlobal("AudioContext", class {
      close = closeContext
      createAnalyser = () => ({
        fftSize: 512,
        getByteTimeDomainData: (samples: Uint8Array) => samples.fill(level),
      })
      createMediaStreamSource = () => ({ connect: () => {} })
    })
    root = createRoot(document.createElement("div"))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const renderProbe = async (active: boolean, onSpeech: () => void): Promise<void> => {
    await act(async () => {
      root.render(React.createElement(Probe, { active, onSpeech }))
      await Promise.resolve()
    })
  }

  it("stays off unless enabled", async () => {
    await renderProbe(false, vi.fn())
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it("reports sustained speech once per cooldown and releases the microphone when deactivated", async () => {
    const onSpeech = vi.fn()
    await renderProbe(true, onSpeech)
    act(() => vi.advanceTimersByTime(1_000))
    expect(onSpeech).not.toHaveBeenCalled()

    level = 200
    act(() => vi.advanceTimersByTime(600))
    expect(onSpeech).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(5_000))
    expect(onSpeech).toHaveBeenCalledTimes(1)

    await renderProbe(false, onSpeech)
    expect(stopTrack).toHaveBeenCalled()
    expect(closeContext).toHaveBeenCalled()
  })

  it("releases a microphone that finishes opening after deactivation", async () => {
    let resolveStream: (value: unknown) => void = () => {}
    getUserMedia.mockImplementationOnce(() => new Promise((resolve) => { resolveStream = resolve }))
    await renderProbe(true, vi.fn())
    await renderProbe(false, vi.fn())
    await act(async () => {
      resolveStream({ getTracks: () => [{ stop: stopTrack }] })
      await Promise.resolve()
    })
    expect(stopTrack).toHaveBeenCalled()
  })
})
