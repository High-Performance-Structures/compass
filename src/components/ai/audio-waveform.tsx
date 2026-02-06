"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

const BAR_WIDTH = 2
const MAX_HEIGHT = 24
const MIN_HEIGHT = 2

interface AudioWaveformProps {
  readonly stream: MediaStream
  readonly barCount?: number
  readonly className?: string
}

export function AudioWaveform({
  stream,
  barCount = 50,
  className,
}: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.75
    source.connect(analyser)

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const bars: HTMLDivElement[] = []
    const frag = document.createDocumentFragment()
    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement("div")
      bar.style.cssText =
        `width:${BAR_WIDTH}px;` +
        `height:${MIN_HEIGHT}px;` +
        `min-height:${MIN_HEIGHT}px;` +
        "border-radius:9999px;" +
        "background:currentColor;" +
        "transition:height 60ms ease-out;"
      frag.appendChild(bar)
      bars.push(bar)
    }
    container.appendChild(frag)

    let animId: number

    const draw = () => {
      analyser.getByteFrequencyData(dataArray)

      for (let i = 0; i < barCount; i++) {
        // sample from lower 50% of bins (speech frequencies)
        const idx = Math.floor(
          (i / barCount) * bufferLength * 0.5
        )
        const value = dataArray[idx] / 255

        // hann window taper so edges fade to dots
        const t = i / (barCount - 1)
        const taper = 0.5 * (1 - Math.cos(2 * Math.PI * t))

        const height = Math.max(
          MIN_HEIGHT,
          value * taper * MAX_HEIGHT
        )
        bars[i].style.height = `${height}px`
      }

      animId = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(animId)
      audioCtx.close()
      container.textContent = ""
    }
  }, [stream, barCount])

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex items-center justify-center gap-px",
        className
      )}
    />
  )
}
